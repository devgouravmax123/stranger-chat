-- Add profile preference columns if they do not already exist.
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "language" TEXT;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "goal" TEXT;

-- Give existing users default values.
UPDATE "User"
SET "language" = 'English'
WHERE "language" IS NULL;

UPDATE "User"
SET "goal" = 'casual-chat'
WHERE "goal" IS NULL;

-- Make the fields required for future users.
ALTER TABLE "User"
ALTER COLUMN "language" SET DEFAULT 'English';

ALTER TABLE "User"
ALTER COLUMN "language" SET NOT NULL;

ALTER TABLE "User"
ALTER COLUMN "goal" SET DEFAULT 'casual-chat';

ALTER TABLE "User"
ALTER COLUMN "goal" SET NOT NULL;