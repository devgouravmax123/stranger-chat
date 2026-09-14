-- AlterTable
ALTER TABLE "User" ADD COLUMN     "goal" TEXT,
ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "language" TEXT;
