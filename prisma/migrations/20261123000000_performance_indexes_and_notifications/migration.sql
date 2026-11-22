-- Ensure notifications table exists cleanly under Prisma migrations instead of runtime DDL
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'INFO',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "dedupe_key" TEXT,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_recipient_read_created_idx"
  ON "notifications"("recipient_user_id", "is_read", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_recipient_dedupe_key_key"
  ON "notifications"("recipient_user_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_recipient_user_id_fkey"
    FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Performance indexes aligned with core list, escalation, and reporting queries
CREATE INDEX IF NOT EXISTS "portfolio_media_status_resource_type_created_at_idx"
  ON "portfolio_media"("status", "resource_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "portfolio_media_public_id_idx"
  ON "portfolio_media"("public_id");

CREATE INDEX IF NOT EXISTS "inquiries_created_at_id_idx"
  ON "inquiries"("created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "inquiries_client_phone_idx"
  ON "inquiries"("client_phone");

CREATE INDEX IF NOT EXISTS "quotes_inquiry_id_idx"
  ON "quotes"("inquiry_id");

CREATE INDEX IF NOT EXISTS "quotes_status_created_at_idx"
  ON "quotes"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "quotes_created_at_id_idx"
  ON "quotes"("created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "bookings_status_created_at_idx"
  ON "bookings"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "bookings_created_at_id_idx"
  ON "bookings"("created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "event_sessions_status_start_at_end_at_idx"
  ON "event_sessions"("status", "start_at", "end_at");

CREATE INDEX IF NOT EXISTS "payment_entries_type_verification_state_created_at_idx"
  ON "payment_entries"("type", "verification_state", "created_at");

CREATE INDEX IF NOT EXISTS "payment_entries_created_at_idx"
  ON "payment_entries"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "deliverables_assignee_user_id_review_status_due_at_idx"
  ON "deliverables"("assignee_user_id", "review_status", "due_at");
