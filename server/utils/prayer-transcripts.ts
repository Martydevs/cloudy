// Transcripciones de Peticiones (revisión antes de generar): el texto de la foto de cada petición, una fila por foto y
// compartida por el equipo. Aquí vive todo el SQL de `prayer_transcripts` y la lectura con el modelo: comprueba que la
// petición siga disponible, elige qué objeto del bucket ve el modelo, firma una URL corta, llama a la IA y traduce cada
// fallo a HTTP. Importa `#server/ai` solo para leer la foto. Al proveedor solo viaja la foto, nunca nombres, notas, IP ni
// ids, y el registro solo lleva códigos. Los endpoints no tocan drizzle.
import { eq, inArray, sql } from 'drizzle-orm'
import { PRAYER_PHOTO_MEDIA_TYPES, transcribePrayerPhoto } from '#server/ai'
import type { PrayerPhotoInput, PrayerTranscriptErrorCode } from '#server/ai'
import type { PrayerErrorCode } from '#shared/constants/prayers'
import { PRAYER_TEXT_MAX_LENGTH } from '#shared/constants/prayers'
import type { PrayerTranscript } from '#shared/types/api'
import { prayerTranscripts, profiles } from '../db/schema'
import { prayerError } from './prayer-errors'
import type { PrayerPhoto } from './prayer-requests'
import { loadEligibleRequests } from './prayer-requests'
import { toSongPerson } from './songs'
import { presignGet } from './storage'

/** Vida de la URL firmada de la foto: cubre una lectura de 45 s con su reintento y la descarga de OpenRouter. */
const PHOTO_URL_TTL_SEC = 300

/** Quien lee o guarda: su id y lo que la tarjeta muestra de quien verificó. */
export interface TranscriptEditor { userId: string, name: string, status: string }

type PhotoSource = { key: string, mediaType: PrayerPhotoInput['mediaType'] }

const isReadable = (mime: string): mime is PrayerPhotoInput['mediaType'] =>
  (PRAYER_PHOTO_MEDIA_TYPES as readonly string[]).includes(mime)

/**
 * Qué objeto del bucket ve el modelo: la copia JPEG de una HEIC antigua si existe; si no, el original cuando es JPEG, PNG,
 * WebP o GIF. Las subidas nuevas ya llegan convertidas a JPEG desde el navegador; queda fuera la HEIC que no se pudo
 * convertir (más de 5 MB o falló la conversión): `null`.
 */
export function photoSource(photo: Pick<PrayerPhoto, 'storageKey' | 'previewKey' | 'mimeType'>): PhotoSource | null {
  if (photo.previewKey) return { key: photo.previewKey, mediaType: 'image/jpeg' }
  const mime = photo.mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : photo.mimeType.toLowerCase()
  return isReadable(mime) ? { key: photo.storageKey, mediaType: mime } : null
}

/**
 * `invalid_input` es un fallo interno (el endpoint ya validó): al cliente le llega como `provider`. `rejected` (OpenRouter
 * rechazó la clave o el preset) es, para el equipo, lo mismo que no tener clave: `not_configured`, sin «Reintentar».
 */
function httpCode(error: PrayerTranscriptErrorCode): PrayerErrorCode {
  if (error === 'invalid_input') return 'provider'
  if (error === 'rejected') return 'not_configured'
  return error
}

const columns = {
  fileId: prayerTranscripts.fileId,
  text: prayerTranscripts.text,
  status: prayerTranscripts.status,
  origin: prayerTranscripts.origin,
  verifiedAt: prayerTranscripts.verifiedAt,
  verifiedBy: prayerTranscripts.verifiedBy,
  updatedAt: prayerTranscripts.updatedAt,
}

type TranscriptRow = {
  fileId: string
  text: string
  status: PrayerTranscript['status']
  origin: PrayerTranscript['origin']
  verifiedAt: Date | null
  verifiedBy: string | null
  updatedAt: Date
}

function toTranscript(row: TranscriptRow, verifier: { name: string | null, status: string | null } | null): PrayerTranscript {
  return {
    fileId: row.fileId,
    text: row.text,
    status: row.status,
    origin: row.origin,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verifiedBy: row.verifiedBy && verifier ? toSongPerson(row.verifiedBy, verifier.name, verifier.status) : null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Las transcripciones guardadas de esos ids, en una consulta; los ids sin transcripción no aparecen. */
export async function listPrayerTranscripts(fileIds: string[]): Promise<PrayerTranscript[]> {
  if (fileIds.length === 0) return []
  const rows = await useDb()
    .select({ ...columns, verifierName: profiles.name, verifierStatus: profiles.status })
    .from(prayerTranscripts)
    .leftJoin(profiles, eq(prayerTranscripts.verifiedBy, profiles.userId))
    .where(inArray(prayerTranscripts.fileId, fileIds))
  return rows.map(row => toTranscript(row, { name: row.verifierName, status: row.verifierStatus }))
}

/**
 * Lee la foto de una petición con el modelo y guarda el resultado como borrador. Si ya hay una transcripción y no se pide
 * `force`, la devuelve sin llamar al modelo (un doble clic o una segunda persona no gastan crédito). Sin `force` una
 * lectura nunca pisa lo que alguien guardó mientras el modelo leía; con `force` reemplaza el texto y lo deja sin
 * verificar. Lanza errores HTTP con `data.code`.
 */
export async function readPrayerTranscript(
  fileId: string,
  { force = false, me, abortSignal }: { force?: boolean, me: TranscriptEditor, abortSignal?: AbortSignal },
): Promise<PrayerTranscript> {
  if (!force) {
    const [stored] = await listPrayerTranscripts([fileId])
    if (stored) return stored
  }

  const { found, missing } = await loadEligibleRequests([fileId])
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  const source = photoSource(found[0]!)
  if (!source) {
    console.warn('[prayer-transcript] unreadable_image')
    throw prayerError('unreadable_image', { ids: [fileId] })
  }
  // Sin clave no se firma nada ni se llama a nadie.
  if (!useRuntimeConfig().openrouterApikey?.trim()) {
    console.error('[prayer-transcript] not_configured')
    throw prayerError('not_configured')
  }

  // URL firmada: OpenRouter descarga la foto directo del bucket y sus bytes no pasan por esta función.
  const photo: PrayerPhotoInput = { url: await presignGet(source.key, {}, PHOTO_URL_TTL_SEC), mediaType: source.mediaType }
  const result = await transcribePrayerPhoto({ photo, abortSignal })
  if (result.status === 'failed') {
    const code = httpCode(result.error)
    // Saldo agotado o clave/preset rechazados piden acción de un administrador: se registran como error.
    const log = code === 'quota_exceeded' || code === 'not_configured' ? console.error : console.warn
    log(result.error === 'rejected'
      ? '[prayer-transcript] not_configured (OpenRouter rejected the key or preset)'
      : `[prayer-transcript] ${code}`)
    throw prayerError(code)
  }

  const now = new Date()
  const draft = {
    // La tabla guarda hasta 1000 caracteres; la persona compara el borrador con la foto antes de verificarlo.
    text: result.text.slice(0, PRAYER_TEXT_MAX_LENGTH).trim(),
    status: 'draft' as const,
    origin: 'model' as const,
    verifiedBy: null,
    verifiedAt: null,
    updatedBy: me.userId,
    updatedAt: now,
  }
  const insert = useDb().insert(prayerTranscripts).values({ fileId, ...draft, createdAt: now })
  const [row] = await (force
    ? insert.onConflictDoUpdate({ target: prayerTranscripts.fileId, set: draft })
    : insert.onConflictDoNothing()
  ).returning(columns)
  if (row) return toTranscript(row, null)
  // Alguien guardó esta transcripción mientras el modelo leía: vale la suya.
  const [stored] = await listPrayerTranscripts([fileId])
  if (!stored) throw prayerError('request_unavailable', { ids: [fileId] })
  return stored
}

/**
 * Guarda el texto que escribió o aceptó una persona («Guardar», la casilla «Verificada», «Escribir a mano»). El origen
 * pasa a `manual` si no había fila o el texto cambió; `verified` sella quién y cuándo, y sin él se limpian. La petición
 * debe seguir disponible (`409 request_unavailable`).
 */
export async function savePrayerTranscript(
  fileId: string,
  { text, verified }: { text: string, verified: boolean },
  me: TranscriptEditor,
): Promise<PrayerTranscript> {
  const { missing } = await loadEligibleRequests([fileId])
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  const now = new Date()
  const values = {
    text,
    status: verified ? 'verified' as const : 'draft' as const,
    verifiedBy: verified ? me.userId : null,
    verifiedAt: verified ? now : null,
    updatedBy: me.userId,
    updatedAt: now,
  }
  const [row] = await useDb()
    .insert(prayerTranscripts)
    .values({ fileId, ...values, origin: 'manual', createdAt: now })
    .onConflictDoUpdate({
      target: prayerTranscripts.fileId,
      set: {
        ...values,
        // Marcar como verificado el texto del modelo sin tocarlo no lo vuelve «manual».
        origin: sql`CASE WHEN ${prayerTranscripts.text} = excluded.text THEN ${prayerTranscripts.origin} ELSE 'manual' END`,
      },
    })
    .returning(columns)
  return toTranscript(row!, verified ? { name: me.name, status: me.status } : null)
}

/**
 * Los textos verificados de esas peticiones, para generar. `unverified` son los ids sin transcripción, en borrador o con
 * el texto en blanco: con alguno no se genera nada.
 */
export async function loadVerifiedTexts(fileIds: string[]): Promise<{ texts: Map<string, string>, unverified: string[] }> {
  const texts = new Map<string, string>()
  if (fileIds.length > 0) {
    const rows = await useDb()
      .select({ fileId: prayerTranscripts.fileId, text: prayerTranscripts.text, status: prayerTranscripts.status })
      .from(prayerTranscripts)
      .where(inArray(prayerTranscripts.fileId, fileIds))
    for (const row of rows) {
      if (row.status === 'verified' && row.text.trim() !== '') texts.set(row.fileId, row.text)
    }
  }
  return { texts, unverified: fileIds.filter(id => !texts.has(id)) }
}

/** Los textos verificados de esas peticiones; `409 transcript_unverified` con `data.ids` si a alguna le falta. */
export async function requireVerifiedTexts(fileIds: string[]): Promise<Map<string, string>> {
  const { texts, unverified } = await loadVerifiedTexts(fileIds)
  if (unverified.length > 0) throw prayerError('transcript_unverified', { ids: unverified })
  return texts
}
