CREATE TABLE "youtube_downloads" (
	"video_id" text PRIMARY KEY NOT NULL,
	"format" text NOT NULL,
	"downloaded_by" text NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_downloads_format" CHECK ("youtube_downloads"."format" IN ('mp4_720', 'mp4_1080', 'mp3'))
);
--> statement-breakpoint
ALTER TABLE "youtube_downloads" ADD CONSTRAINT "youtube_downloads_video_id_youtube_videos_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."youtube_videos"("video_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_downloads" ADD CONSTRAINT "youtube_downloads_downloaded_by_profiles_user_id_fk" FOREIGN KEY ("downloaded_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "youtube_downloads_recent_idx" ON "youtube_downloads" USING btree ("downloaded_at" DESC NULLS LAST,"video_id" DESC NULLS LAST);