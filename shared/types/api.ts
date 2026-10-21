// DTOs del contrato HTTP (specs/001-shared-media-drive/contracts/api.md).
import type { FileCategory } from '../constants/files'
import type { Role } from '../permissions'

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
