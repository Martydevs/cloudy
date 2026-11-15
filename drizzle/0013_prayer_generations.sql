CREATE TABLE "prayer_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"groups" jsonb NOT NULL,
	CONSTRAINT "prayer_generations_groups_count" CHECK (jsonb_typeof("prayer_generations"."groups") = 'array' AND jsonb_array_length("prayer_generations"."groups") BETWEEN 1 AND 10)
);
--> statement-breakpoint
ALTER TABLE "prayer_images" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "prayer_generations" ADD CONSTRAINT "prayer_generations_created_by_profiles_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prayer_generations_created_idx" ON "prayer_generations" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "prayer_images" ADD CONSTRAINT "prayer_images_generation_id_prayer_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."prayer_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prayer_images_generation_idx" ON "prayer_images" USING btree ("generation_id") WHERE "prayer_images"."generation_id" IS NOT NULL;