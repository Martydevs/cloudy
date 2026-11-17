CREATE TYPE "public"."prayer_transcript_origin" AS ENUM('model', 'manual');--> statement-breakpoint
CREATE TYPE "public"."prayer_transcript_status" AS ENUM('draft', 'verified');--> statement-breakpoint
CREATE TABLE "prayer_transcripts" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"status" "prayer_transcript_status" DEFAULT 'draft' NOT NULL,
	"origin" "prayer_transcript_origin" NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_transcripts_text_length" CHECK (char_length("prayer_transcripts"."text") <= 1000),
	CONSTRAINT "prayer_transcripts_verified" CHECK (("prayer_transcripts"."status" = 'verified') = ("prayer_transcripts"."verified_at" IS NOT NULL AND "prayer_transcripts"."verified_by" IS NOT NULL) AND ("prayer_transcripts"."status" = 'draft' OR btrim("prayer_transcripts"."text") <> ''))
);
--> statement-breakpoint
ALTER TABLE "prayer_transcripts" ADD CONSTRAINT "prayer_transcripts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_transcripts" ADD CONSTRAINT "prayer_transcripts_verified_by_profiles_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_transcripts" ADD CONSTRAINT "prayer_transcripts_updated_by_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;