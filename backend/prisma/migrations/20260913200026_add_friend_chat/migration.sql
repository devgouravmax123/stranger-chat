/*
  Warnings:

  - You are about to drop the column `chatId` on the `Friendship` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_chatId_fkey";

-- DropIndex
DROP INDEX "Friendship_chatId_key";

-- AlterTable
ALTER TABLE "Friendship" DROP COLUMN "chatId";

-- CreateTable
CREATE TABLE "FriendChat" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,

    CONSTRAINT "FriendChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,

    CONSTRAINT "FriendMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FriendChat_userAId_idx" ON "FriendChat"("userAId");

-- CreateIndex
CREATE INDEX "FriendChat_userBId_idx" ON "FriendChat"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendChat_userAId_userBId_key" ON "FriendChat"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "FriendMessage_chatId_createdAt_idx" ON "FriendMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "FriendMessage_senderId_idx" ON "FriendMessage"("senderId");

-- AddForeignKey
ALTER TABLE "FriendChat" ADD CONSTRAINT "FriendChat_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendChat" ADD CONSTRAINT "FriendChat_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "FriendChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendMessage" ADD CONSTRAINT "FriendMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
