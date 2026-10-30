CREATE TYPE "public"."access_request_status" AS ENUM('open', 'approved', 'rejected', 'used');--> statement-breakpoint
CREATE TYPE "public"."submission_origin" AS ENUM('link', 'permission');--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'access.approve';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE 'access.reject';--> statement-breakpoint
CREATE TABLE "guest_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_name" text NOT NULL,
	"sender_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "access_request_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"submission_id" uuid,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "guest_submissions" ADD COLUMN "origin" "submission_origin" DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_submissions" ADD COLUMN "access_granted_by" text;--> statement-breakpoint
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_decided_by_profiles_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_submission_id_guest_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."guest_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_access_requests_token_idx" ON "guest_access_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_access_requests_status_created_idx" ON "guest_access_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "guest_submissions" ADD CONSTRAINT "guest_submissions_access_granted_by_profiles_user_id_fk" FOREIGN KEY ("access_granted_by") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- SQL manual (feature 003, data-model): reglas de la solicitud de acceso que Drizzle no expresa.
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_name_length" CHECK (char_length("sender_name") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_open_undecided" CHECK (("status" = 'open') = ("decided_at" IS NULL));--> statement-breakpoint
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_window" CHECK (("status" IN ('approved', 'used')) = ("access_expires_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "guest_access_requests" ADD CONSTRAINT "guest_access_requests_used" CHECK (("status" = 'used') = ("used_at" IS NOT NULL));