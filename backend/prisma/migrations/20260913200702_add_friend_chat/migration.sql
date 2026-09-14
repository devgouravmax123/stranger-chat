/*
  Warnings:

  - You are about to drop the `FriendChat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FriendMessage` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[chatId]` on the table `Friendship` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "FriendChat" DROP CONSTRAINT "FriendChat_userAId_fkey";

-- DropForeignKey
ALTER TABLE "FriendChat" DROP CONSTRAINT "FriendChat_userBId_fkey";

-- DropForeignKey
ALTER TABLE "FriendMessage" DROP CONSTRAINT "FriendMessage_chatId_fkey";

-- DropForeignKey
ALTER TABLE "FriendMessage" DROP CONSTRAINT "FriendMessage_senderId_fkey";

-- AlterTable
ALTER TABLE "Friendship" ADD COLUMN     "chatId" TEXT;

-- DropTable
DROP TABLE "FriendChat";

-- DropTable
DROP TABLE "FriendMessage";

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_chatId_key" ON "Friendship"("chatId");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
