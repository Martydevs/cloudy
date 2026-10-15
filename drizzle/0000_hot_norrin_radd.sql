CREATE TYPE "public"."activity_action" AS ENUM('file.upload', 'file.rename', 'file.move', 'file.trash', 'file.restore', 'file.purge', 'folder.create', 'folder.rename', 'folder.move', 'folder.trash', 'folder.restore', 'folder.purge', 'trash.empty', 'submission.approve', 'submission.reject', 'comment.admin_delete', 'user.activate', 'user.disable', 'user.role_change', 'user.remove');--> statement-breakpoint
CREATE TYPE "public"."file_category" AS ENUM('image', 'audio', 'video', 'presentation', 'document');--> statement-breakpoint
CREATE TYPE "public"."file_origin" AS ENUM('team', 'guest');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('uploading', 'ready');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'editor');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'disabled', 'removed');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" text,
	"actor_label" text NOT NULL,
	"action" "activity_action" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"extension" text NOT NULL,
	"mime_type" text NOT NULL,
	"category" "file_category" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"upload_status" "upload_status" DEFAULT 'uploading' NOT NULL,
	"origin" "file_origin" NOT NULL,
	"uploaded_by" text,
	"guest_name" text,
	"submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"trash_root_id" uuid,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"trash_root_id" uuid
);
--> statement-breakpoint
CREATE TABLE "guest_submission_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"extension" text NOT NULL,
	"mime_type" text NOT NULL,
	"category" "file_category" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"upload_status" "upload_status" DEFAULT 'uploading' NOT NULL,
	CONSTRAINT "guest_submission_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "guest_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_name" text NOT NULL,
	"note" text,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"sender_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"target_folder_id" uuid,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role",
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	CONSTRAINT "profiles_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_profiles_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_profiles_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_submission_id_guest_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."guest_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_profiles_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_profiles_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_submission_files" ADD CONSTRAINT "guest_submission_files_submission_id_guest_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."guest_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_reviewed_by_profiles_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_target_folder_id_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_approved_by_profiles_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_created_idx" ON "activity_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "comments_file_created_idx" ON "comments" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "files_folder_created_idx" ON "files" USING btree ("folder_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "files_category_idx" ON "files" USING btree ("category");--> statement-breakpoint
CREATE INDEX "files_deleted_at_idx" ON "files" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "files_trash_root_idx" ON "files" USING btree ("trash_root_id");--> statement-breakpoint
CREATE INDEX "files_upload_status_created_idx" ON "files" USING btree ("upload_status","created_at");--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "folders_deleted_at_idx" ON "folders" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "folders_trash_root_idx" ON "folders" USING btree ("trash_root_id");--> statement-breakpoint
CREATE INDEX "guest_submission_files_submission_idx" ON "guest_submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "guest_submissions_status_created_idx" ON "guest_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "files_name_trgm_idx" ON "files" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "folders_name_trgm_idx" ON "folders" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "files_folder_name_unique" ON "files" (coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name")) WHERE "deleted_at" IS NULL AND "upload_status" = 'ready';--> statement-breakpoint
CREATE UNIQUE INDEX "folders_parent_name_unique" ON "folders" (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name")) WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size_range" CHECK ("size_bytes" BETWEEN 1 AND 104857600);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_guest_name_required" CHECK ("origin" <> 'guest' OR "guest_name" IS NOT NULL);
