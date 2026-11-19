CREATE TYPE "public"."work_day_kind" AS ENUM('normal', 'special');--> statement-breakpoint
CREATE TYPE "public"."work_day_status" AS ENUM('not_started', 'in_progress', 'finished');--> statement-breakpoint
CREATE TABLE "work_day_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_day_id" uuid NOT NULL,
	"song_collection_id" uuid,
	"youtube_playlist_id" uuid,
	"folder_id" uuid,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_day_materials_one_ref" CHECK (num_nonnulls("work_day_materials"."song_collection_id", "work_day_materials"."youtube_playlist_id", "work_day_materials"."folder_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "work_day_members" (
	"work_day_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "work_day_members_work_day_id_user_id_pk" PRIMARY KEY("work_day_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "work_day_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_day_id" uuid NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "work_day_slots_order" CHECK ("work_day_slots"."end_time" > "work_day_slots"."start_time")
);
--> statement-breakpoint
CREATE TABLE "work_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"work_date" date NOT NULL,
	"kind" "work_day_kind" NOT NULL,
	"status" "work_day_status" DEFAULT 'not_started' NOT NULL,
	"auditorium" text DEFAULT 'Skykids Auditorium' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_days_title_length" CHECK (char_length("work_days"."title") BETWEEN 1 AND 120 AND "work_days"."title" = btrim("work_days"."title")),
	CONSTRAINT "work_days_auditorium_length" CHECK (char_length("work_days"."auditorium") BETWEEN 1 AND 80 AND "work_days"."auditorium" = btrim("work_days"."auditorium"))
);
--> statement-breakpoint
ALTER TABLE "work_day_materials" ADD CONSTRAINT "work_day_materials_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_materials" ADD CONSTRAINT "work_day_materials_song_collection_id_song_collections_id_fk" FOREIGN KEY ("song_collection_id") REFERENCES "public"."song_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_materials" ADD CONSTRAINT "work_day_materials_youtube_playlist_id_youtube_playlists_id_fk" FOREIGN KEY ("youtube_playlist_id") REFERENCES "public"."youtube_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_materials" ADD CONSTRAINT "work_day_materials_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_materials" ADD CONSTRAINT "work_day_materials_added_by_profiles_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_members" ADD CONSTRAINT "work_day_members_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_members" ADD CONSTRAINT "work_day_members_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_day_slots" ADD CONSTRAINT "work_day_slots_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_day_materials_song_collection_key" ON "work_day_materials" USING btree ("work_day_id","song_collection_id") WHERE "work_day_materials"."song_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_day_materials_youtube_playlist_key" ON "work_day_materials" USING btree ("work_day_id","youtube_playlist_id") WHERE "work_day_materials"."youtube_playlist_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_day_materials_folder_key" ON "work_day_materials" USING btree ("work_day_id","folder_id") WHERE "work_day_materials"."folder_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_day_materials_song_collection_idx" ON "work_day_materials" USING btree ("song_collection_id");--> statement-breakpoint
CREATE INDEX "work_day_materials_youtube_playlist_idx" ON "work_day_materials" USING btree ("youtube_playlist_id");--> statement-breakpoint
CREATE INDEX "work_day_materials_folder_idx" ON "work_day_materials" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "work_day_members_user_idx" ON "work_day_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_day_slots_day_idx" ON "work_day_slots" USING btree ("work_day_id","start_time");--> statement-breakpoint
CREATE INDEX "work_days_date_idx" ON "work_days" USING btree ("work_date","id");