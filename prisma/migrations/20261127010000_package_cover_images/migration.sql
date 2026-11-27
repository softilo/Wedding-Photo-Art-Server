-- Add optional cover image metadata to packages so packages can showcase
-- an isolated cover photo without leaking into public portfolio galleries.
ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "cover_image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "cover_image_asset_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cover_image_public_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cover_image_format" TEXT,
  ADD COLUMN IF NOT EXISTS "cover_image_bytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "cover_image_width" INTEGER,
  ADD COLUMN IF NOT EXISTS "cover_image_height" INTEGER;

CREATE INDEX IF NOT EXISTS "packages_cover_image_public_id_idx"
  ON "packages"("cover_image_public_id");
