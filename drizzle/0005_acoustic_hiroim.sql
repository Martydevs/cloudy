CREATE TABLE "youtube_playlist_items" (
	"playlist_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_playlist_items_playlist_id_video_id_pk" PRIMARY KEY("playlist_id","video_id")
);
--> statement-breakpoint
CREATE TABLE "youtube_playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_playlists_name_length" CHECK (char_length("youtube_playlists"."name") BETWEEN 1 AND 80 AND "youtube_playlists"."name" = btrim("youtube_playlists"."name"))
);
--> statement-breakpoint
CREATE TABLE "youtube_videos" (
	"video_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"channel" text,
	"duration_seconds" integer,
	"thumbnail_url" text,
	"last_viewed_at" timestamp with time zone,
	"last_viewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_videos_video_id_format" CHECK ("youtube_videos"."video_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "youtube_videos_title_length" CHECK (char_length("youtube_videos"."title") BETWEEN 1 AND 300),
	CONSTRAINT "youtube_videos_channel_length" CHECK ("youtube_videos"."channel" IS NULL OR char_length("youtube_videos"."channel") <= 200),
	CONSTRAINT "youtube_videos_duration" CHECK ("youtube_videos"."duration_seconds" IS NULL OR "youtube_videos"."duration_seconds" >= 0),
	CONSTRAINT "youtube_videos_thumbnail_https" CHECK ("youtube_videos"."thumbnail_url" IS NULL OR "youtube_videos"."thumbnail_url" LIKE 'https://%'),
	CONSTRAINT "youtube_videos_last_viewed_pair" CHECK (("youtube_videos"."last_viewed_at" IS NULL) = ("youtube_videos"."last_viewed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "youtube_playlist_items" ADD CONSTRAINT "youtube_playlist_items_playlist_id_youtube_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."youtube_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_playlist_items" ADD CONSTRAINT "youtube_playlist_items_video_id_youtube_videos_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."youtube_videos"("video_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_playlist_items" ADD CONSTRAINT "youtube_playlist_items_added_by_profiles_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_playlists" ADD CONSTRAINT "youtube_playlists_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_videos" ADD CONSTRAINT "youtube_videos_last_viewed_by_profiles_user_id_fk" FOREIGN KEY ("last_viewed_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "youtube_playlist_items_video_idx" ON "youtube_playlist_items" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "youtube_playlists_updated_idx" ON "youtube_playlists" USING btree ("updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "youtube_videos_history_idx" ON "youtube_videos" USING btree ("last_viewed_at" DESC NULLS LAST,"video_id" DESC NULLS LAST) WHERE "youtube_videos"."last_viewed_at" IS NOT NULL;