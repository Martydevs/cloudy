CREATE TABLE "song_collection_items" (
	"collection_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "song_collection_items_collection_id_song_id_pk" PRIMARY KEY("collection_id","song_id")
);
--> statement-breakpoint
CREATE TABLE "song_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "song_collections_name_length" CHECK (char_length("song_collections"."name") BETWEEN 1 AND 80 AND "song_collections"."name" = btrim("song_collections"."name"))
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"lyrics" jsonb NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"last_viewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "songs_source_url_format" CHECK ("songs"."source_url" ~ '^https://letras\.com/[a-z0-9-]+/[a-z0-9-]+$'),
	CONSTRAINT "songs_title_length" CHECK (char_length("songs"."title") BETWEEN 1 AND 200),
	CONSTRAINT "songs_artist_length" CHECK ("songs"."artist" IS NULL OR char_length("songs"."artist") <= 200),
	CONSTRAINT "songs_lyrics_array" CHECK (jsonb_typeof("songs"."lyrics") = 'array' AND jsonb_array_length("songs"."lyrics") >= 1),
	CONSTRAINT "songs_last_viewed_pair" CHECK (("songs"."last_viewed_at" IS NULL) = ("songs"."last_viewed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "song_collection_items" ADD CONSTRAINT "song_collection_items_collection_id_song_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."song_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_collection_items" ADD CONSTRAINT "song_collection_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_collection_items" ADD CONSTRAINT "song_collection_items_added_by_profiles_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_collections" ADD CONSTRAINT "song_collections_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_last_viewed_by_profiles_user_id_fk" FOREIGN KEY ("last_viewed_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "song_collection_items_song_idx" ON "song_collection_items" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "song_collections_updated_idx" ON "song_collections" USING btree ("updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_source_url_key" ON "songs" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "songs_history_idx" ON "songs" USING btree ("last_viewed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "songs"."last_viewed_at" IS NOT NULL;