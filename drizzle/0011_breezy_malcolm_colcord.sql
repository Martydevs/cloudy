-- Retirada de la lectura de texto de imágenes (feature 002). Se borran las columnas del texto extraído de `files` y
-- `guest_submission_files`, su FK, sus CHECK manuales y el índice trigram de la búsqueda; el enum `image_text_status`
-- queda sin uso y se borra al final.
--
-- DESTRUCTIVA: las transcripciones guardadas se pierden. Haz una instantánea de la rama antes de ejecutarla.
--
-- Se conserva `text_source_key` en ambas tablas: la copia JPEG de los HEIC (`textsrc/<id>.jpg`) sigue subiéndose y la
-- limpieza diaria la borra junto al original.
-- El valor `file.text_edit` del enum `activity_action` también se conserva: Postgres no borra valores de un enum y el
-- registro de actividad antiguo los usa.
--
-- Los CHECK y el índice son SQL manual de 0003 (no están en schema.ts): se borran aquí explícitamente. Postgres los
-- borraría igual con la columna, pero así la intención queda escrita.
DROP INDEX IF EXISTS "files_text_trgm_idx";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_text_length";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP CONSTRAINT IF EXISTS "guest_files_text_length";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_text_edited_by_profiles_user_id_fk";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_status";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_content";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_error";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_attempts";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_started_at";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_read_at";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_edited_by";--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN IF EXISTS "text_edited_at";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_status";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_content";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_error";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_attempts";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_started_at";--> statement-breakpoint
ALTER TABLE "guest_submission_files" DROP COLUMN IF EXISTS "text_read_at";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."image_text_status";
