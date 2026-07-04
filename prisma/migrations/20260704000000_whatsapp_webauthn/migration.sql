-- WhatsApp bot sessions (Meta Cloud API FSM keyed by phone)
CREATE TABLE "whatsapp_sessions" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "userId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'idle',
  "context" JSONB NOT NULL DEFAULT '{}',
  "lastMessageAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_sessions_phone_key" ON "whatsapp_sessions"("phone");
CREATE UNIQUE INDEX "whatsapp_sessions_userId_key" ON "whatsapp_sessions"("userId");
CREATE INDEX "whatsapp_sessions_phone_idx" ON "whatsapp_sessions"("phone");

ALTER TABLE "whatsapp_sessions"
  ADD CONSTRAINT "whatsapp_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- WebAuthn credentials (passkey for payout signing)
CREATE TABLE "webauthn_credentials" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialId" BYTEA NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT,
  "deviceType" TEXT NOT NULL DEFAULT 'singleDevice',
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "label" TEXT,
  "lastUsedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");
CREATE INDEX "webauthn_credentials_userId_idx" ON "webauthn_credentials"("userId");

ALTER TABLE "webauthn_credentials"
  ADD CONSTRAINT "webauthn_credentials_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
