// Validadores de la página Peticiones (feature 007, data-model.md § Validación): la query del listado, el cuerpo de la
// generación, el historial de imágenes y sus colecciones. El servidor es la autoridad; el cliente arma la misma query con
// `usePrayerFilters` y valida el nombre de una colección con `prayerCollectionSchema` (app/utils/form-schemas.ts).
import { PRAYER_HISTORY_MAX_LIMIT, PRAYER_HISTORY_PAGE, PRAYER_PER_IMAGE } from '../constants/prayers'
import type { Field } from './core'
import { array, int, object, oneOf, optional, str, uuid } from './core'
import { songCollectionName } from './songs'

const DATE_MESSAGE = 'Fecha no válida'
const RANGE_MESSAGE = 'La fecha final debe ser posterior a la inicial'
/** Instante con zona: `2026-11-07T06:00:00.000Z` o `2026-11-07T00:00:00-06:00`. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/

/** Instante ISO 8601 con zona horaria, normalizado a UTC (`toISOString()`). */
function isoInstant(): Field<string> {
  return (input) => {
    if (typeof input !== 'string' || input.length > 40 || !ISO_INSTANT_RE.test(input)) return { ok: false, error: DATE_MESSAGE }
    const time = Date.parse(input)
    return Number.isNaN(time) ? { ok: false, error: DATE_MESSAGE } : { ok: true, value: new Date(time).toISOString() }
  }
}

export type PrayersDir = 'asc' | 'desc'

/** Query de `GET /api/peticiones`: todo opcional; `from` inclusivo, `to` exclusivo y `dir` `desc` por defecto. */
export const prayersQuery = object({
  q: optional(str({ min: 0, max: 100 })),
  from: optional(isoInstant()),
  to: optional(isoInstant()),
  dir: (input: unknown) => {
    const res = optional(oneOf(['asc', 'desc'] as const))(input)
    return res.ok ? { ok: true as const, value: res.value ?? 'desc' } : res
  },
  cursor: optional(str({ max: 500 })),
}, (raw) => {
  const from = isoInstant()(raw.from)
  const to = isoInstant()(raw.to)
  return from.ok && to.ok && Date.parse(from.value) >= Date.parse(to.value) ? { to: RANGE_MESSAGE } : null
})

export type PrayersQuery = { q?: string, from?: string, to?: string, dir?: PrayersDir, cursor?: string }

/** 1–4 ids de archivo distintos: una imagen. */
function fileIdList(): Field<string[]> {
  const list = array(uuid(), { min: 1, max: PRAYER_PER_IMAGE, label: 'peticiones' })
  return (input) => {
    const res = list(input)
    if (res.ok && new Set(res.value).size !== res.value.length) return { ok: false, error: 'No repitas peticiones en la misma imagen' }
    return res
  }
}

/** Cuerpo de `POST /api/peticiones/imagenes`. El navegador no manda texto: el servidor lo relee (FR-027). */
export const prayerImageInput = object({ fileIds: fileIdList() })

/** Query de `GET /api/peticiones/imagenes`: `limit` 1–48 (12 por defecto) y `cursor` keyset opcional. */
export const prayerHistoryQuery = object({
  limit: (input: unknown) => {
    const res = optional(int({ min: 1, max: PRAYER_HISTORY_MAX_LIMIT }))(input)
    return res.ok ? { ok: true as const, value: res.value ?? PRAYER_HISTORY_PAGE } : res
  },
  cursor: optional(str({ max: 500 })),
})

/** Nombre de una colección de imágenes: la misma regla que las colecciones de canciones (1–80 caracteres tras recortar). */
export const prayerCollectionName = songCollectionName

/** Cuerpo de `POST /api/peticiones/colecciones`: con `imageId`, la colección nace con esa imagen. */
export const prayerCollectionInput = object({
  name: prayerCollectionName(),
  imageId: optional(uuid()),
})

export const prayerCollectionRename = object({ name: prayerCollectionName() })

export const prayerCollectionItemInput = object({ imageId: uuid() })
