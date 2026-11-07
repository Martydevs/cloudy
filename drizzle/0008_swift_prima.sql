ALTER TABLE "guest_access_requests" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "guest_access_requests" CASCADE;--> statement-breakpoint
ALTER TABLE "guest_submissions" DROP CONSTRAINT "guest_submissions_access_granted_by_profiles_user_id_fk";
--> statement-breakpoint
ALTER TABLE "guest_submissions" DROP COLUMN "origin";--> statement-breakpoint
ALTER TABLE "guest_submissions" DROP COLUMN "access_granted_by";--> statement-breakpoint
DROP TYPE "public"."access_request_status";--> statement-breakpoint
DROP TYPE "public"."submission_origin";