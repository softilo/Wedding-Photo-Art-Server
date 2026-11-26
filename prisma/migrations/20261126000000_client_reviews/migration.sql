-- Create client_reviews table for homepage testimonial showcase & dashboard management
CREATE TABLE IF NOT EXISTS "client_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_name" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 5,
  "event_title" TEXT,
  "source_label" TEXT,
  "image_url" TEXT NOT NULL,
  "image_asset_id" TEXT,
  "image_public_id" TEXT,
  "image_format" TEXT,
  "image_bytes" INTEGER,
  "image_width" INTEGER,
  "image_height" INTEGER,
  "is_published" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_reviews_rating_range_chk" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE INDEX IF NOT EXISTS "client_reviews_is_published_sort_order_created_at_idx"
  ON "client_reviews"("is_published", "sort_order", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "client_reviews_image_public_id_idx"
  ON "client_reviews"("image_public_id");
