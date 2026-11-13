CREATE TABLE "prayer_image_collection_items" (
	"collection_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_image_collection_items_collection_id_image_id_pk" PRIMARY KEY("collection_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "prayer_image_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_image_collections_name_length" CHECK (char_length("prayer_image_collections"."name") BETWEEN 1 AND 80 AND "prayer_image_collections"."name" = btrim("prayer_image_collections"."name"))
);
--> statement-breakpoint
CREATE TABLE "prayer_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"file_ids" uuid[] NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prayer_images_file_ids_count" CHECK (cardinality("prayer_images"."file_ids") BETWEEN 1 AND 4),
	CONSTRAINT "prayer_images_size" CHECK ("prayer_images"."size_bytes" BETWEEN 1 AND 4000000)
);
--> statement-breakpoint
ALTER TABLE "prayer_image_collection_items" ADD CONSTRAINT "prayer_image_collection_items_collection_id_prayer_image_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."prayer_image_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_image_collection_items" ADD CONSTRAINT "prayer_image_collection_items_image_id_prayer_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."prayer_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_image_collection_items" ADD CONSTRAINT "prayer_image_collection_items_added_by_profiles_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_image_collections" ADD CONSTRAINT "prayer_image_collections_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prayer_images" ADD CONSTRAINT "prayer_images_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prayer_image_collection_items_image_idx" ON "prayer_image_collection_items" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "prayer_image_collections_updated_idx" ON "prayer_image_collections" USING btree ("updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "prayer_images_storage_key_key" ON "prayer_images" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "prayer_images_history_idx" ON "prayer_images" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);