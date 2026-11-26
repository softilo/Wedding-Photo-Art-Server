-- Dedicated tables for Studio Services and About/Team so all showcase content & images
-- live cleanly in PostgreSQL and never leak into portfolio_media or public portfolio galleries.
CREATE TABLE IF NOT EXISTS "studio_services" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "image_url" TEXT,
  "image_asset_id" TEXT,
  "image_public_id" TEXT,
  "image_format" TEXT,
  "image_bytes" INTEGER,
  "image_width" INTEGER,
  "image_height" INTEGER,
  "show_on_home" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_services_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "studio_services_is_active_show_on_home_sort_order_created_at_idx"
  ON "studio_services"("is_active", "show_on_home", "sort_order", "created_at");

CREATE INDEX IF NOT EXISTS "studio_services_image_public_id_idx"
  ON "studio_services"("image_public_id");

CREATE TABLE IF NOT EXISTS "studio_about_profile" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "services_section_enabled" BOOLEAN NOT NULL DEFAULT true,
  "story_eyebrow" TEXT NOT NULL,
  "story_title" TEXT NOT NULL,
  "story_lead" TEXT NOT NULL,
  "story_body" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_about_profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "studio_team_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "subtitle" TEXT,
  "role" TEXT NOT NULL DEFAULT '',
  "specialty" TEXT NOT NULL DEFAULT '',
  "bio" TEXT NOT NULL DEFAULT '',
  "quote" TEXT,
  "phone" TEXT,
  "instagram" TEXT,
  "location" TEXT,
  "is_featured" BOOLEAN NOT NULL DEFAULT false,
  "image_url" TEXT,
  "image_asset_id" TEXT,
  "image_public_id" TEXT,
  "image_format" TEXT,
  "image_bytes" INTEGER,
  "image_width" INTEGER,
  "image_height" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_team_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "studio_team_members_is_active_is_featured_sort_order_created_at_idx"
  ON "studio_team_members"("is_active", "is_featured" DESC, "sort_order", "created_at");

CREATE INDEX IF NOT EXISTS "studio_team_members_image_public_id_idx"
  ON "studio_team_members"("image_public_id");
