/*
  Warnings:

  - A unique constraint covering the columns `[chatId]` on the table `Friendship` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN     "chatId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_chatId_key" ON "Friendship"("chatId");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
