// DTOs del contrato HTTP (specs/001-shared-media-drive/contracts/api.md).
import type { FileCategory } from '../constants/files'
import type { Role } from '../permissions'
import type { YoutubeBlockReason, YoutubeEngine, YoutubeFormat } from '../constants/youtube'
import type { SongPresentationItemError } from '../constants/songs'

export type UserStatus = 'pending' | 'active' | 'disabled' | 'removed'
export type FileOrigin = 'team' | 'guest'
export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface AuthUser {
  id: string
  email: string
  name: string
}

export interface Profile {
  userId: string
  email: string
  name: string
  role: Role | null
  status: UserStatus
  createdAt: string
}

export interface Me {
  user: AuthUser
  profile: Profile
}

export interface UsersPage {
  items: Profile[]
  total: number
}

/**
 * Por qué una cuenta de la selección no cambió: `last_admin` (dejaría el sistema sin administradores), `not_found`
 * (ya no existe o fue eliminada) o `unchanged` (la acción no le aplica: ya estaba así, o no está activa).
 */
export interface UsersBatchSkip { id: string, reason: 'last_admin' | 'not_found' | 'unchanged' }

/** `POST /api/users/batch`: las cuentas que cambiaron y las que no, con su motivo. */
export interface UsersBatchResult {
  updated: string[]
  skipped: UsersBatchSkip[]
}

export interface Breadcrumb {
  id: string | null
  name: string
}

export interface FolderItem {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  itemCount?: number
}

export interface FileItem {
  id: string
  folderId: string | null
  name: string
  extension: string
  mimeType: string
  category: FileCategory
  sizeBytes: number
  hasThumbnail: boolean
  origin: FileOrigin
  uploadedBy: { id: string, name: string } | null
  guestName: string | null
  createdAt: string
  updatedAt: string
  /** Nombres de las carpetas ancestro (búsqueda y detalle). */
  path?: string[]
  commentCount?: number
  /** Solo en la búsqueda (feature 002): dónde coincidió la consulta. */
  matchedIn?: 'name' | 'text'
}

export interface FolderChildren {
  folder: FolderItem | null
  breadcrumbs: Breadcrumb[]
  folders: FolderItem[]
  files: FileItem[]
  nextCursor: string | null
}

export interface FolderTreeNode {
  id: string
  name: string
  parentId: string | null
}

export interface TrashItem {
  id: string
  kind: 'file' | 'folder'
  name: string
  originalPath: string[]
  deletedBy: string | null
  deletedAt: string
  daysLeft: number
  itemCount: number
  bytes: number
}

/** `POST /api/items/trash`: cuántos elementos de la selección fueron a la papelera y cuáles ya no estaban visibles. */
export interface TrashItemsResult {
  trashed: number
  skipped: string[]
}

export interface TrashRestoreResult {
  /** Nombre final (con sufijo si el original ya estaba en uso). */
  name: string
  restoredTo: { folderId: string | null, path: string[] }
  /** La carpeta original sigue en la papelera: el elemento quedó en "Archivos". */
  movedToRoot: boolean
}

export interface SubmissionFile {
  id: string
  name: string
  category: FileCategory
  size: number
  previewUrl: string
  /** Texto leído de la imagen (feature 002); `null` si no es imagen. */
  text: ImageText | null
}

export interface Submission {
  id: string
  senderName: string
  note: string | null
  status: SubmissionStatus
  createdAt: string
  expiresAt: string
  files: SubmissionFile[]
}

export interface Comment {
  id: string
  body: string
  author: { id: string, name: string }
  createdAt: string
  editedAt: string | null
  canEdit: boolean
  canDelete: boolean
}

export interface ActivityEntry {
  id: number
  actorId: string | null
  actorLabel: string
  action: string
  targetType: string
  targetId: string | null
  targetLabel: string
  meta: Record<string, unknown> | null
  createdAt: string
}

export interface Pulse {
  cursor: string
  pendingCount: number
  newSubmissions: { id: string, senderName: string, fileCount: number, createdAt: string }[]
  /** Cuentas por aprobar; solo el admin recibe el valor real (los demás, 0). */
  pendingUsers: number
}

export interface DashboardSummary {
  recentFiles: FileItem[]
  pendingCount: number
  totalsByCategory: Record<FileCategory, { count: number, bytes: number }>
  storage: { activeBytes: number, trashBytes: number }
}

export interface Paginated<T> {
  items: T[]
  nextCursor: string | null
}

export interface UploadTicket {
  fileId: string
  uploadUrl: string
  thumbUploadUrl?: string
  /** PUT de la copia JPEG de una HEIC apta (`textsrc/<id>.jpg`). */
  textSourceUploadUrl?: string
  headers: Record<string, string>
}

export interface GuestUploadTicket {
  fileId: string
  uploadUrl: string
  /** PUT de la copia JPEG de una HEIC apta (`textsrc/<id>.jpg`). */
  textSourceUploadUrl?: string
  headers: Record<string, string>
}

/** `pending` es `NULL` en la base de datos: la imagen aún no se ha leído. */
export type ImageTextStatus = 'pending' | 'reading' | 'ready' | 'empty' | 'failed' | 'unavailable'
export type ImageTextError = 'timeout' | 'provider' | 'rate_limited' | 'quota_exceeded' | 'invalid_input' | 'invalid_output'

/** Texto extraído de una imagen (feature 002, data-model "DTO compartido"). */
export interface ImageText {
  status: ImageTextStatus
  /** Solo en `ready`. */
  text: string | null
  error: ImageTextError | null
  readAt: string | null
  editedAt: string | null
  /** Nombre visible de quien lo corrigió. */
  editedBy: string | null
}

// ---------------------------------------------------------------- Peticiones (feature 007, data-model § Petición)

/** Una imagen de un envío de invitado aprobado (tarjeta de la página Peticiones). */
export interface PrayerRequest {
  /** `files.id`: también el id para `/api/files/:id/text` y `/content`. */
  id: string
  name: string
  senderName: string
  note: string | null
  /** ISO: cuándo lo envió el invitado. */
  sentAt: string
  /** ISO: cuándo se aprobó (orden y filtro). */
  approvedAt: string
  previewUrl: string
  text: ImageText
}

/** Quien generó una imagen, creó una colección o agregó una imagen: la misma forma que en Canciones. */
export type PrayerPerson = SongPerson

/** Una imagen de peticiones ya generada y guardada (historial). Las URLs pasan por `/content`: no caducan. */
export interface PrayerGeneratedImage {
  id: string
  /** `/api/peticiones/imagenes/:id/content` → 302 a una URL firmada. */
  previewUrl: string
  /** Lo mismo con `?download=1` (`Content-Disposition: attachment`). */
  downloadUrl: string
  /** Ids de las peticiones (para «Generar de nuevo»); el texto se relee en el servidor. */
  fileIds: string[]
  requestCount: number
  author: PrayerPerson
  /** ISO */
  createdAt: string
}

/** Colección del equipo con imágenes generadas. */
export interface PrayerImageCollection {
  id: string
  name: string
  author: PrayerPerson
  /** Conteo por subconsulta en el mismo select (sin N+1). */
  itemCount: number
  createdAt: string
  updatedAt: string
}
export interface PrayerImageCollectionItem extends PrayerGeneratedImage { addedAt: string, addedBy: PrayerPerson }
export interface PrayerImageCollectionDetail extends PrayerImageCollection { items: PrayerImageCollectionItem[] }

// ---------------------------------------------------------------- YouTube (feature 005, data-model § DTOs)

export type { YoutubeBlockReason, YoutubeEngine, YoutubeFormat } from '../constants/youtube'

export interface YoutubePerson { userId: string, name: string, active: boolean }

export interface YoutubeVideo {
  videoId: string
  title: string
  channel: string | null
  durationSeconds: number | null
  thumbnailUrl: string | null
}

export interface YoutubeVideoDetail extends YoutubeVideo {
  availableHeights: number[]
  downloadable: boolean
  reason: YoutubeBlockReason | null
}

export interface YoutubeHistoryItem extends YoutubeVideo { viewedAt: string, viewedBy: YoutubePerson | null }
export interface YoutubeHistoryPage { items: YoutubeHistoryItem[], nextCursor: string | null }

/** Una descarga guardada (sección «Descargas»): el video, quién lo bajó, cuándo y en qué formato. */
export interface YoutubeDownloadItem extends YoutubeVideo { format: YoutubeFormat, downloadedAt: string, downloadedBy: YoutubePerson | null }
export interface YoutubeDownloadsPage { items: YoutubeDownloadItem[], nextCursor: string | null }

export interface YoutubePlaylist {
  id: string
  name: string
  author: YoutubePerson
  itemCount: number
  /** Hasta 4 miniaturas de los videos agregados más recientemente. */
  covers: string[]
  createdAt: string
  updatedAt: string
}
export interface YoutubePlaylistItem extends YoutubeVideo { addedAt: string, addedBy: YoutubePerson }
export interface YoutubePlaylistDetail extends YoutubePlaylist { items: YoutubePlaylistItem[] }

export type YoutubeJobStatus = 'queued' | 'running' | 'zipping' | 'done' | 'failed' | 'expired'
export interface YoutubeJobItem {
  videoId: string
  title: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  /** 0–100. */
  progress: number
  error: { code: string, message: string } | null
  actualHeight: number | null
}
export interface YoutubeJob {
  jobId: string
  /** Motor que lo creó: el trabajo se consulta y se cancela con `?engine=` (su enlace sale del mismo prefijo). */
  engine: YoutubeEngine
  status: YoutubeJobStatus
  format: YoutubeFormat
  /** 0–100. */
  progress: number
  items: YoutubeJobItem[]
  downloadUrl: string | null
  filename: string | null
  sizeBytes: number | null
  /** ISO del vencimiento del archivo. */
  expiresAt: string | null
}
export interface YoutubeServiceHealth { state: 'up' | 'waking' | 'down' }

// ---------------------------------------------------------------- Canciones (feature 006, data-model § DTOs)

export type { SongErrorCode } from '../constants/songs'

export interface SongPerson { userId: string, name: string, active: boolean }

/** Lo que muestran tarjetas e historial (sin letra). */
export interface Song {
  id: string
  title: string
  artist: string | null
  sourceUrl: string
}

export interface SongHistoryItem extends Song {
  /** ISO */
  viewedAt: string
  viewedBy: SongPerson | null
}
export interface SongHistoryPage { items: SongHistoryItem[], nextCursor: string | null }

/** Ficha: la canción más la letra y fechas. */
export interface SongDetail extends Song {
  /** Estrofas → líneas. */
  lyrics: string[][]
  lineCount: number
  createdAt: string
  updatedAt: string
}
export interface SongFetchResult { song: SongDetail, crawled: boolean }

export interface SongCollection {
  id: string
  name: string
  author: SongPerson
  /** Conteo por subconsulta en el mismo select (sin N+1). */
  itemCount: number
  createdAt: string
  updatedAt: string
}
export interface SongCollectionItem extends Song { addedAt: string, addedBy: SongPerson }
export interface SongCollectionDetail extends SongCollection { items: SongCollectionItem[] }

export interface SongPresentationMeta { slideCount: number | null, arrangedBy: 'llm' | 'fallback' | null, filename: string }

/**
 * Una canción de `POST /api/songs/presentations`, en el orden pedido. `done` → `filename` es su entrada en el `.zip`;
 * `failed` → `errorCode` dice por qué (los textos están en `SONG_PRESENTATION_ITEM_MESSAGES`).
 */
export interface SongPresentationBatchItem {
  songId: string
  status: 'done' | 'failed'
  filename: string | null
  slideCount: number | null
  arrangedBy: 'llm' | 'fallback' | null
  errorCode: SongPresentationItemError | null
}
