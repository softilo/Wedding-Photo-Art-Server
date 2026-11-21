-- AlterTable
ALTER TABLE "expense_entries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "portfolio_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "portfolio_media" ALTER COLUMN "id" DROP DEFAULT;
