-- Chat upgrades: reactions, pin, reply threads, search, read markers, media.
-- Apply via: psql $DATABASE_URL -f prisma/migrations/chat_upgrades.sql
-- Then update prisma/schema.prisma to reflect and run `prisma db pull` + `prisma generate`.

ALTER TABLE "ChatMessage"
  ADD COLUMN IF NOT EXISTS "replyToId" TEXT,
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "pinnedById" TEXT,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "attachments" JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "ChatMessage_pinned_idx" ON "ChatMessage" ("chamaId", "pinnedAt") WHERE "pinnedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ChatMessage_reply_idx" ON "ChatMessage" ("replyToId");
CREATE INDEX IF NOT EXISTS "ChatMessage_content_trgm_idx" ON "ChatMessage" USING gin ("content" gin_trgm_ops);
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "ChatReaction" (
  "id" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("messageId", "userId", "emoji")
);
CREATE INDEX IF NOT EXISTS "ChatReaction_message_idx" ON "ChatReaction" ("messageId");

CREATE TABLE IF NOT EXISTS "ChatReadMarker" (
  "userId" TEXT NOT NULL,
  "chamaId" TEXT NOT NULL,
  "lastReadMessageId" TEXT,
  "lastReadAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("userId", "chamaId")
);
