-- La copia JPEG de los HEIC deja de ser un resto de la feature 002 y pasa a ser la vista previa de las HEIC antiguas
-- (las nuevas se convierten a JPEG en el navegador y ya no llevan copia): la columna `text_source_key` se renombra a
-- `preview_key` en `files` y `guest_submission_files`.
--
-- NO destructiva: RENAME COLUMN conserva los datos (es un cambio de catálogo, sin reescribir la tabla). A mano a
-- propósito: drizzle-kit podría generar DROP COLUMN + ADD COLUMN para un renombre, lo que borraría las claves.
--
-- El prefijo de los objetos en el bucket (`textsrc/<id>.jpg`) NO cambia: Neon Object Storage no tiene `CopyObject`.
ALTER TABLE "files" RENAME COLUMN "text_source_key" TO "preview_key";--> statement-breakpoint
ALTER TABLE "guest_submission_files" RENAME COLUMN "text_source_key" TO "preview_key";
