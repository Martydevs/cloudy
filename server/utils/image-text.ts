// Capa de aplicación del texto de imágenes (feature 002, plan "Organización por capas"): la única que
// usan los endpoints. Orquesta elegibilidad → reclamar → descargar → firma → IA → guardar. Nunca SQL
// directo (usa el store) ni detalles del proveedor (usa `#server/ai`).
import { createError } from 'h3'
import { createProviderBreaker, extractImageText, imageSourceSchema, resolveImageTextModel } from '#server/ai'
import type { ExtractImageTextOptions, ImageTextResult } from '#server/ai'
import type { ImageText, ImageTextError, ImageTextStatus } from '#shared/types/api'
import { isImageTextEligible, MAX_IMAGE_TEXT_BYTES, READING_STALE_MS } from '#shared/constants/image-text'
import { activityInsert } from './activity'
import type { Actor } from './activity'
import { matchesSignature } from './file-signature'
import { remainingMs } from './background'
import {
  claimImageText,
  editImageTextQuery,
  listPendingSubmissionImages,
  loadImageTextRow,
  markUnavailable,
  releaseImageText,
  saveImageTextResult,
  setTextSourceKey,
} from './image-text-store'
import { hitRateLimit } from './rate-limit'
import type { ClaimedImageText, ImageTextOutcome, ImageTextRow, ImageTextTarget } from './image-text-store'
import { deleteMany, head, readRange } from './storage'
import { textSourceKeyFor } from './uploads'

const iso = (value: Date | null) => value?.toISOString() ?? null

/** Una lectura en `reading` más antigua que `READING_STALE_MS` se muestra como `failed`/`timeout` (FR-007). */
function isStale(row: Pick<ImageTextRow, 'textStartedAt'>, now: number): boolean {
  return !row.textStartedAt || now - row.textStartedAt.getTime() > READING_STALE_MS
}

/** DTO de la fila. La fila no cambia: la siguiente reclamación toma una lectura vencida. */
export function toImageText(row: ImageTextRow, now = Date.now()): ImageText {
  const base = { readAt: iso(row.textReadAt), editedAt: iso(row.textEditedAt), editedBy: row.textEditedAt ? row.editedByName : null }
  if (row.textStatus === 'reading' && isStale(row, now)) {
    return { ...base, status: 'failed', text: null, error: 'timeout' }
  }
  const status: ImageTextStatus = row.textStatus ?? 'pending'
  return {
    ...base,
    status,
    text: status === 'ready' ? row.textContent : null,
    error: status === 'failed' ? (row.textError as ImageTextError | null) ?? 'provider' : null,
  }
}

/** DTO tras una lectura terminada en esta petición. */
function outcomeDto(outcome: ImageTextOutcome | { status: 'unavailable' }): ImageText {
  return {
    status: outcome.status,
    text: outcome.status === 'ready' ? outcome.text : null,
    error: outcome.status === 'failed' ? outcome.error as ImageTextError : null,
    readAt: outcome.status === 'unavailable' ? null : new Date().toISOString(),
    editedAt: null,
    editedBy: null,
  }
}

/** Código breve para el registro: nunca el mensaje (puede llevar texto leído). */
function codeOf(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : 'unknown'
}

export type ReadOptions = Pick<ExtractImageTextOptions, 'abortSignal' | 'breaker' | 'model'>

/**
 * Lee una fila ya reclamada y guarda el resultado. Al modelo solo van los bytes de la imagen, tal como
 * están guardados (FR-019). Nunca lanza: cualquier fallo queda en la fila como `failed`.
 */
export async function readImageText(target: ImageTextTarget, row: ClaimedImageText, options: ReadOptions = {}): Promise<ImageText> {
  const extension = row.extension.toLowerCase()
  const unavailable = async () => {
    await markUnavailable(target)
    return outcomeDto({ status: 'unavailable' })
  }
  const save = async (outcome: ImageTextOutcome) => {
    await saveImageTextResult(target, row.claimedAt, outcome)
    return outcomeDto(outcome)
  }

  try {
    if (row.category !== 'image') return await unavailable()
    const source = imageSourceSchema.safeParse({ fileId: row.id, extension, sizeBytes: row.sizeBytes })
    if (!source.success) {
      const shape = source.error.issues.some(issue => issue.path[0] === 'extension' || issue.path[0] === 'sizeBytes')
      return shape ? await unavailable() : await save({ status: 'failed', error: 'invalid_input' })
    }

    const isHeic = extension === 'heic'
    if (isHeic && !row.textSourceKey) return await unavailable()
    const objectKey = isHeic ? row.textSourceKey! : row.storageKey
    // La copia de una HEIC no tiene tamaño en la fila; se validó ≤ 5 MB al completar la subida.
    const data = await readRange(objectKey, 0, (isHeic ? MAX_IMAGE_TEXT_BYTES : row.sizeBytes) - 1)
    const signatureExt = isHeic ? 'jpg' : extension
    if (!matchesSignature(signatureExt, data)) return await unavailable()

    const result: ImageTextResult = await extractImageText({
      image: { mediaType: signatureExt === 'png' ? 'image/png' : 'image/jpeg', data },
      abortSignal: options.abortSignal,
      breaker: options.breaker,
      model: options.model,
    })
    if (result.status === 'failed') console.warn(`[image-text] ${target.table}:${row.id} failed (${result.error})`)
    return await save(result.status === 'ready'
      ? { status: 'ready', text: result.text }
      : result.status === 'empty' ? { status: 'empty' } : { status: 'failed', error: result.error })
  }
  catch (error) {
    console.error(`[image-text] ${target.table}:${row.id} read error (${codeOf(error)})`)
    try {
      return await save({ status: 'failed', error: 'provider' })
    }
    catch {
      return outcomeDto({ status: 'failed', error: 'provider' })
    }
  }
}

/**
 * Lectura de una imagen del equipo (en segundo plano al completar la subida y como respaldo al abrirla):
 * reclama desde `NULL` o una lectura vencida; con una lectura vigente o un estado terminal no hace nada.
 * Nunca lanza.
 */
export async function readFileImage(fileId: string): Promise<void> {
  const target: ImageTextTarget = { table: 'files', id: fileId }
  try {
    const claimed = await claimImageText(target)
    if (claimed) await readImageText(target, claimed)
  }
  catch (error) {
    console.error(`[image-text] files:${fileId} claim error (${codeOf(error)})`)
  }
}

const conflict = (message: string) => createError({ statusCode: 409, statusMessage: 'Conflict', message })

/**
 * Reglas comunes de `POST …/text` (contracts/api). Sin `force`: los estados terminales se devuelven tal
 * cual; `NULL` o una lectura vencida se leen en la petición; una lectura vigente responde `reading`.
 * Con `force` (Reintentar, Volver a leer): lee desde `failed`/`ready`/`empty`, o 409.
 */
export async function requestImageTextRead(target: ImageTextTarget, { force = false }: { force?: boolean } = {}): Promise<ImageText> {
  const row = await loadImageTextRow(target)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La imagen no existe' })

  if (!canReadImageText(row, !!row.textSourceKey)) {
    if (force && row.textStatus === 'unavailable') throw conflict('Este archivo no admite la lectura de texto')
    if (row.textStatus !== 'unavailable') await markUnavailable(target)
    return outcomeDto({ status: 'unavailable' })
  }

  const now = Date.now()
  const readingNow = row.textStatus === 'reading' && !isStale(row, now)
  if (!force) {
    if (readingNow) return toImageText(row, now)
    if (row.textStatus !== null && row.textStatus !== 'reading') return toImageText(row, now)
  }
  else if (readingNow) {
    throw conflict('El texto se está leyendo. Espera unos segundos.')
  }
  else if (row.textStatus === 'unavailable') {
    throw conflict('Este archivo no admite la lectura de texto')
  }

  const claimed = await claimImageText(target, { force })
  if (!claimed) {
    // Otro lector se adelantó: se muestra su lectura en curso.
    if (force) throw conflict('El texto se está leyendo. Espera unos segundos.')
    const current = await loadImageTextRow(target)
    return current ? toImageText(current) : outcomeDto({ status: 'failed', error: 'provider' })
  }
  return readImageText(target, claimed)
}

/** Estado actual del texto de una imagen, o 404. */
export async function getImageText(target: ImageTextTarget): Promise<ImageText> {
  const row = await loadImageTextRow(target)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La imagen no existe' })
  return toImageText(row)
}

/**
 * Valida la copia JPEG de una HEIC al completar la subida (research A4): 0 < tamaño ≤ 5 MB y firma JPEG.
 * Válida → `text_source_key`; ausente o inválida → se borra (si existe) y la imagen queda `unavailable`.
 * Devuelve si la copia es válida. Nunca lanza.
 */
export async function checkTextSourceCopy(target: ImageTextTarget): Promise<boolean> {
  const sourceKey = textSourceKeyFor(target.id)
  try {
    const object = await head(sourceKey)
    const valid = !!object
      && object.size > 0
      && object.size <= MAX_IMAGE_TEXT_BYTES
      && matchesSignature('jpg', await readRange(sourceKey, 0, 4095))
    if (valid) {
      await setTextSourceKey(target, sourceKey)
      return true
    }
    if (object) await deleteMany([sourceKey])
    await markUnavailable(target)
    return false
  }
  catch (error) {
    console.error(`[image-text] ${target.table}:${target.id} copy check error (${codeOf(error)})`)
    await markUnavailable(target).catch(() => {})
    return false
  }
}

/** Presupuesto máximo de las lecturas de un envío, y margen antes del plazo real de la función (A6). */
const SUBMISSION_BUDGET_MS = 240_000
const DEADLINE_MARGIN_MS = 15_000
/** Límite de lecturas por remitente (FR-008, research A7). */
const GUEST_TEXT_LIMIT = { limit: 20, windowSec: 3600 }

/**
 * Lee en segundo plano las imágenes aptas de un envío de invitado (research A6): hasta `concurrency` a la
 * vez, con un presupuesto compartido de `min(240 s, plazo real - 15 s)` y un cortacircuito propio de esta
 * ejecución. Cada trabajador reclama su imagen justo antes de leerla; lo que no se inicia queda pendiente
 * (`NULL`) y se lee al abrir Solicitudes. Sin clave de OpenRouter no se inicia ninguna. Al modelo solo van
 * los bytes (FR-019). Nunca lanza.
 */
export async function readSubmissionImages(submissionId: string, { concurrency = 4, budgetMs }: { concurrency?: number, budgetMs?: number } = {}): Promise<void> {
  try {
    const budget = budgetMs ?? Math.min(SUBMISSION_BUDGET_MS, (remainingMs() ?? Number.POSITIVE_INFINITY) - DEADLINE_MARGIN_MS)
    if (budget <= 0) return
    const model = resolveImageTextModel(useRuntimeConfig())
    if (!model) return
    const signal = AbortSignal.timeout(budget)
    const { senderKey, rows } = await listPendingSubmissionImages(submissionId)
    const queue = rows.filter(row => canReadImageText(row, !!row.textSourceKey))
    const breaker = createProviderBreaker()

    let next = 0
    const worker = async () => {
      // Orden por imagen: presupuesto → cortacircuito → reclamar → límite → leer.
      while (next < queue.length && !signal.aborted && !breaker.isOpen()) {
        const row = queue[next++]!
        const target: ImageTextTarget = { table: 'guest_submission_files', id: row.id }
        try {
          const claimed = await claimImageText(target)
          if (!claimed) continue
          const allowed = await hitRateLimit(null, `guest-text:${senderKey}`, GUEST_TEXT_LIMIT).then(() => true, () => false)
          if (!allowed) {
            // Sin cupo: la imagen vuelve a pendiente y se leerá cuando alguien abra el envío.
            await releaseImageText(target, claimed.claimedAt)
            continue
          }
          await readImageText(target, claimed, { abortSignal: signal, breaker, model })
        }
        catch (error) {
          console.error(`[image-text] ${target.table}:${row.id} pool error (${codeOf(error)})`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  }
  catch (error) {
    console.error(`[image-text] submission:${submissionId} pool error (${codeOf(error)})`)
  }
}

/** La imagen se puede leer: apta por el archivo y, si es HEIC, con copia válida. */
export function canReadImageText(file: { category: string, extension: string, sizeBytes: number }, hasTextSource: boolean): boolean {
  if (!isImageTextEligible({ category: file.category, extension: file.extension, size: file.sizeBytes })) return false
  return file.extension.toLowerCase() !== 'heic' || hasTextSource
}

/**
 * Guarda la corrección manual del texto de un archivo (FR-014, FR-018) y la registra en la actividad en el
 * mismo lote, solo con su longitud (nunca el texto). 409 si se está leyendo o no admite lectura.
 */
export async function saveImageTextEdit(file: { id: string, name: string }, text: string, actor: Actor): Promise<ImageText> {
  const target: ImageTextTarget = { table: 'files', id: file.id }
  const row = await loadImageTextRow(target)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'No encontrado', message: 'La imagen no existe' })
  if (row.textStatus === 'reading' && !isStale(row, Date.now())) {
    throw conflict('El texto se está leyendo. Espera unos segundos y vuelve a intentarlo.')
  }
  if (row.textStatus === 'unavailable' || !canReadImageText(row, !!row.textSourceKey)) {
    throw conflict('Este archivo no admite la lectura de texto')
  }
  await useDb().batch([
    editImageTextQuery(file.id, text, actor.userId),
    activityInsert(actor, 'file.text_edit', { type: 'file', id: file.id, label: file.name }, { length: text.length }),
  ])
  return getImageText(target)
}
