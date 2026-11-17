// Generaciones de Peticiones (enmienda «Página de generación», 2026-11-15): una generación es todo lo que produce un clic en
// «Generar imágenes», con sus grupos de peticiones en orden (uno por imagen). Aquí vive el SQL de su tabla; las imágenes de
// una generación y la limpieza de las vacías viven en `prayer-gallery.ts`, la capa de las imágenes. Los endpoints no tocan
// drizzle.
import { eq } from 'drizzle-orm'
import { sameRequests } from '#shared/prayers'
import type { PrayerGeneration, PrayerGenerationCreated } from '#shared/types/api'
import { prayerGenerations, profiles } from '../db/schema'
import { listGenerationImages } from './prayer-gallery'
import { prayerError } from './prayer-errors'
import { loadEligibleRequests } from './prayer-requests'
import { loadVerifiedTexts } from './prayer-transcripts'
import { toSongPerson } from './songs'

/**
 * Crea la generación con los grupos de la selección. Antes comprueba que cada petición siga siendo una imagen aprobada y
 * visible (`409 request_unavailable`) y que una persona haya verificado su texto (`409 transcript_unverified`), ambos con
 * `data.ids`: si alguna falla no se crea nada.
 */
export async function createPrayerGeneration(groups: string[][], me: { userId: string }): Promise<PrayerGenerationCreated> {
  const ids = groups.flat()
  const [{ missing }, { unverified }] = await Promise.all([loadEligibleRequests(ids), loadVerifiedTexts(ids)])
  if (missing.length > 0) throw prayerError('request_unavailable', { ids: missing })
  if (unverified.length > 0) throw prayerError('transcript_unverified', { ids: unverified })
  const [row] = await useDb().insert(prayerGenerations).values({ groups, createdBy: me.userId }).returning({ id: prayerGenerations.id })
  return { id: row!.id }
}

/** Los grupos de una generación; `404 generation_not_found` si no existe. */
async function generationGroups(id: string): Promise<string[][]> {
  const [row] = await useDb().select({ groups: prayerGenerations.groups }).from(prayerGenerations).where(eq(prayerGenerations.id, id)).limit(1)
  if (!row) throw prayerError('generation_not_found')
  return row.groups
}

/**
 * Una imagen que dice ser de una generación: la generación existe (`404 generation_not_found`) y sus peticiones son
 * exactamente uno de sus grupos (`409 generation_mismatch`).
 */
export async function assertPrayerGenerationGroup(id: string, fileIds: readonly string[]): Promise<void> {
  const groups = await generationGroups(id)
  if (!groups.some(group => sameRequests(group, fileIds))) throw prayerError('generation_mismatch')
}

/**
 * La generación con sus grupos y, para cada uno, la imagen guardada más reciente con esas peticiones (o `null`). Dos
 * sentencias en paralelo, sin N+1. `404 generation_not_found` si no existe.
 */
export async function getPrayerGeneration(id: string): Promise<PrayerGeneration> {
  const [rows, images] = await Promise.all([
    useDb()
      .select({
        id: prayerGenerations.id,
        groups: prayerGenerations.groups,
        createdBy: prayerGenerations.createdBy,
        createdAt: prayerGenerations.createdAt,
        authorName: profiles.name,
        authorStatus: profiles.status,
      })
      .from(prayerGenerations)
      .leftJoin(profiles, eq(prayerGenerations.createdBy, profiles.userId))
      .where(eq(prayerGenerations.id, id))
      .limit(1),
    listGenerationImages(id),
  ])
  const row = rows[0]
  if (!row) throw prayerError('generation_not_found')
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    author: toSongPerson(row.createdBy, row.authorName, row.authorStatus),
    // `images` viene de la más reciente a la más antigua: la primera que coincide es la última guardada.
    groups: row.groups.map((fileIds, i) => ({
      index: i + 1,
      fileIds,
      image: images.find(image => sameRequests(image.fileIds, fileIds)) ?? null,
    })),
  }
}
