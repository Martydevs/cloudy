-- Feature 002: texto extraído de imágenes (data-model). Idempotente: las ramas de desarrollo y pruebas ya
-- tienen este mismo esquema por una migración anterior que no quedó en el repositorio; en una base nueva
-- (producción) crea todo.
DO $$ BEGIN
  CREATE TYPE "public"."image_text_status" AS ENUM('reading', 'ready', 'empty', 'failed', 'unavailable');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'file.text_edit';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_status" "image_text_status";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_content" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_error" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_source_key" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_edited_by" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "text_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_status" "image_text_status";--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_content" text;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_error" text;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_source_key" text;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD COLUMN IF NOT EXISTS "text_read_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "files" ADD CONSTRAINT "files_text_edited_by_profiles_user_id_fk" FOREIGN KEY ("text_edited_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
-- SQL manual (data-model): CHECK de longitud del texto e índice trigram para la búsqueda (FR-015, SC-006).
DO $$ BEGIN
  ALTER TABLE "files" ADD CONSTRAINT "files_text_length" CHECK ("text_content" IS NULL OR char_length("text_content") <= 10000);
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "guest_submission_files" ADD CONSTRAINT "guest_files_text_length" CHECK ("text_content" IS NULL OR char_length("text_content") <= 10000);
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_text_trgm_idx" ON "files" USING gin ("text_content" gin_trgm_ops);
