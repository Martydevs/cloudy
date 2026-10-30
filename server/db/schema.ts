// Esquema de Cloudy (Drizzle ORM). Ver specs/001-shared-media-drive/data-model.md.
import { relations } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

// ---------------------------------------------------------------- enums

export const userRole = pgEnum('user_role', ['admin', 'editor'])
export const userStatus = pgEnum('user_status', ['pending', 'active', 'disabled', 'removed'])
export const fileCategory = pgEnum('file_category', ['image', 'audio', 'video', 'presentation', 'document'])
export const fileOrigin = pgEnum('file_origin', ['team', 'guest'])
export const uploadStatus = pgEnum('upload_status', ['uploading', 'ready'])
export const submissionStatus = pgEnum('submission_status', ['pending', 'approved', 'rejected', 'expired'])
/** Lectura del texto de una imagen (feature 002); `NULL` = pendiente. */
export const imageTextStatus = pgEnum('image_text_status', ['reading', 'ready', 'empty', 'failed', 'unavailable'])
export const activityAction = pgEnum('activity_action', [
  'file.upload',
  'file.rename',
  'file.move',
  'file.trash',
  'file.restore',
  'file.purge',
  'folder.create',
  'folder.rename',
  'folder.move',
  'folder.trash',
  'folder.restore',
  'folder.purge',
  'trash.empty',
  'submission.approve',
  'submission.reject',
  'comment.admin_delete',
  'user.activate',
  'user.disable',
  'user.role_change',
  'user.remove',
  'file.text_edit',
  'access.approve',
  'access.reject',
])
/** Solicitud de acceso de un invitado (feature 003). "Caducada" no es un valor: se deriva (research B3). */
export const accessRequestStatus = pgEnum('access_request_status', ['open', 'approved', 'rejected', 'used'])
export const submissionOrigin = pgEnum('submission_origin', ['link', 'permission'])

// ---------------------------------------------------------------- profiles

export const profiles = pgTable('profiles', {
  /** id de Neon Auth */
  userId: text('user_id').primaryKey(),
  /** copiado de la sesión; minúsculas */
  email: text('email').notNull().unique(),
  /** 1–80 caracteres */
  name: text('name').notNull(),
  /** null mientras `pending` */
  role: userRole('role'),
  status: userStatus('status').notNull().default('pending'),
  ...timestamps,
  approvedBy: text('approved_by').references((): AnyPgColumn => profiles.userId),
}, t => [
  // Lista de usuarios (pendientes primero, recientes primero) y conteo de pendientes del pulso.
  index('profiles_status_created_idx').on(t.status, t.createdAt),
])

// ---------------------------------------------------------------- folders

export const folders = pgTable('folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
  /** 1–120 car., sin / \ : * ? " < > | */
  name: text('name').notNull(),
  createdBy: text('created_by').notNull().references(() => profiles.userId),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => profiles.userId),
  trashRootId: uuid('trash_root_id'),
}, t => [
  index('folders_parent_idx').on(t.parentId),
  index('folders_deleted_at_idx').on(t.deletedAt),
  index('folders_trash_root_idx').on(t.trashRootId),
])

// Texto extraído de la imagen (feature 002, data-model): mismas columnas en `files` y `guest_submission_files`.
const imageTextColumns = () => ({
  textStatus: imageTextStatus('text_status'),
  /** Solo si `ready`; ≤ 10 000 caracteres (CHECK). */
  textContent: text('text_content'),
  /** Código interno: timeout, provider, rate_limited, quota_exceeded, invalid_input, invalid_output. */
  textError: text('text_error'),
  /** Solo HEIC: copia JPEG `textsrc/<id>.jpg` que subió el navegador. */
  textSourceKey: text('text_source_key'),
  textAttempts: smallint('text_attempts').notNull().default(0),
  textStartedAt: timestamp('text_started_at', { withTimezone: true }),
  textReadAt: timestamp('text_read_at', { withTimezone: true }),
})

// ---------------------------------------------------------------- guest submissions

export const guestSubmissions = pgTable('guest_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 1–80 car. */
  senderName: text('sender_name').notNull(),
  /** ≤ 500 car. */
  note: text('note'),
  status: submissionStatus('status').notNull().default('pending'),
  /** hash SHA-256 de IP + sal */
  senderKey: text('sender_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Momento en que el invitado cerró la subida; el aviso en vivo se basa en esto, no en `created_at`. */
  completedAt: timestamp('completed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by').references(() => profiles.userId),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  targetFolderId: uuid('target_folder_id').references(() => folders.id, { onDelete: 'set null' }),
  /** ≤ 300 car. */
  rejectionReason: text('rejection_reason'),
  /** `link` = página abierta `/enviar`; `permission` = `/upload` con acceso aprobado (feature 003). */
  origin: submissionOrigin('origin').notNull().default('link'),
  /** Copiado de `guest_access_requests.decided_by` al crear un envío `permission`. */
  accessGrantedBy: text('access_granted_by').references(() => profiles.userId, { onDelete: 'set null' }),
}, t => [
  index('guest_submissions_status_created_idx').on(t.status, t.createdAt),
])

// ---------------------------------------------------------------- guest access requests (feature 003)

export const guestAccessRequests = pgTable('guest_access_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 1–80 car. */
  senderName: text('sender_name').notNull(),
  /** hashSender(ip): SHA-256 de IP + sal; nunca la IP. */
  senderKey: text('sender_key').notNull(),
  /** SHA-256 del token de la cookie `cloudy-guest-access` (research B1). */
  tokenHash: text('token_hash').notNull(),
  status: accessRequestStatus('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** `created_at + 8 min` */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedBy: text('decided_by').references(() => profiles.userId, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  /** Solo si `approved`: `decided_at + 30 min`. */
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
  /** Se escribe solo después de insertar ese envío, en el mismo lote (research B4). */
  submissionId: uuid('submission_id').references(() => guestSubmissions.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, t => [
  uniqueIndex('guest_access_requests_token_idx').on(t.tokenHash),
  index('guest_access_requests_status_created_idx').on(t.status, t.createdAt),
])

export const guestSubmissionFiles = pgTable('guest_submission_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => guestSubmissions.id, { onDelete: 'cascade' }),
  originalName: text('original_name').notNull(),
  extension: text('extension').notNull(),
  mimeType: text('mime_type').notNull(),
  category: fileCategory('category').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull().unique(),
  uploadStatus: uploadStatus('upload_status').notNull().default('uploading'),
  ...imageTextColumns(),
}, t => [
  index('guest_submission_files_submission_idx').on(t.submissionId),
])

// ---------------------------------------------------------------- files

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
  /** nombre visible con extensión, 1–200 car. */
  name: text('name').notNull(),
  extension: text('extension').notNull(),
  mimeType: text('mime_type').notNull(),
  category: fileCategory('category').notNull(),
  /** 1 … 104 857 600 */
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull().unique(),
  thumbKey: text('thumb_key'),
  uploadStatus: uploadStatus('upload_status').notNull().default('uploading'),
  origin: fileOrigin('origin').notNull(),
  uploadedBy: text('uploaded_by').references(() => profiles.userId),
  /** requerido si origin='guest' */
  guestName: text('guest_name'),
  submissionId: uuid('submission_id').references(() => guestSubmissions.id, { onDelete: 'set null' }),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: text('deleted_by').references(() => profiles.userId),
  trashRootId: uuid('trash_root_id'),
  ...imageTextColumns(),
  textEditedBy: text('text_edited_by').references(() => profiles.userId, { onDelete: 'set null' }),
  textEditedAt: timestamp('text_edited_at', { withTimezone: true }),
}, t => [
  index('files_folder_created_idx').on(t.folderId, t.createdAt.desc()),
  index('files_category_idx').on(t.category),
  index('files_deleted_at_idx').on(t.deletedAt),
  index('files_trash_root_idx').on(t.trashRootId),
  index('files_upload_status_created_idx').on(t.uploadStatus, t.createdAt),
])

// ---------------------------------------------------------------- comments

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => profiles.userId),
  /** 1–2 000 car. tras trim */
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
}, t => [
  index('comments_file_created_idx').on(t.fileId, t.createdAt),
])

// ---------------------------------------------------------------- activity log

export const activityLog = pgTable('activity_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  /** null = sistema (cron) */
  actorId: text('actor_id').references(() => profiles.userId),
  actorLabel: text('actor_label').notNull(),
  action: activityAction('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  targetLabel: text('target_label').notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index('activity_log_created_idx').on(t.createdAt.desc()),
  index('activity_log_actor_idx').on(t.actorId),
])

// ---------------------------------------------------------------- rate limits

export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
}, t => [
  primaryKey({ columns: [t.key, t.windowStart] }),
])

// ---------------------------------------------------------------- relations

export const profilesRelations = relations(profiles, ({ many }) => ({
  folders: many(folders),
  files: many(files),
  comments: many(comments),
}))

export const foldersRelations = relations(folders, ({ one, many }) => ({
  parent: one(folders, { fields: [folders.parentId], references: [folders.id], relationName: 'folder_parent' }),
  children: many(folders, { relationName: 'folder_parent' }),
  files: many(files),
  creator: one(profiles, { fields: [folders.createdBy], references: [profiles.userId] }),
}))

export const filesRelations = relations(files, ({ one, many }) => ({
  folder: one(folders, { fields: [files.folderId], references: [folders.id] }),
  uploader: one(profiles, { fields: [files.uploadedBy], references: [profiles.userId] }),
  submission: one(guestSubmissions, { fields: [files.submissionId], references: [guestSubmissions.id] }),
  comments: many(comments),
}))

export const guestSubmissionsRelations = relations(guestSubmissions, ({ one, many }) => ({
  files: many(guestSubmissionFiles),
  approvedFiles: many(files),
  accessGranter: one(profiles, { fields: [guestSubmissions.accessGrantedBy], references: [profiles.userId] }),
}))

export const guestAccessRequestsRelations = relations(guestAccessRequests, ({ one }) => ({
  decider: one(profiles, { fields: [guestAccessRequests.decidedBy], references: [profiles.userId] }),
  submission: one(guestSubmissions, { fields: [guestAccessRequests.submissionId], references: [guestSubmissions.id] }),
}))

export const guestSubmissionFilesRelations = relations(guestSubmissionFiles, ({ one }) => ({
  submission: one(guestSubmissions, { fields: [guestSubmissionFiles.submissionId], references: [guestSubmissions.id] }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  file: one(files, { fields: [comments.fileId], references: [files.id] }),
  author: one(profiles, { fields: [comments.authorId], references: [profiles.userId] }),
}))

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  actor: one(profiles, { fields: [activityLog.actorId], references: [profiles.userId] }),
}))
