/**
 * W3C Verifiable Credential issuance (JWT flavour).
 *
 * Issues cryptographic proofs of chama membership, trust score, and KYC
 * tier that partners (SACCOs, insurers, lenders) can verify without
 * calling Pamoja every time. Follows the JWT-VC spec:
 *   https://www.w3.org/TR/vc-data-model/
 *
 * Signing key: ES256 (P-256). Public JWK exposed at /.well-known/jwks.json
 * for anyone to verify.
 *
 * MVP scope:
 *   • MembershipCredential — { chamaId, chamaName, role, joinedAt }
 *   • TrustScoreCredential — { score, band, computedAt }
 *   • KycCredential        — { tier, verifiedAt }
 *
 * Env:
 *   VC_ISSUER_URL=https://api.pamojawealth.app
 *   VC_ISSUER_DID=did:web:pamojawealth.app
 *   VC_PRIVATE_KEY_JWK={"kty":"EC","crv":"P-256",...}  (generated once)
 */
import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { getTrustScore } from "./trust-score.service.js";
import { logger } from "../config/logger.js";

const ISSUER_URL = process.env.VC_ISSUER_URL ?? "https://api.pamojawealth.app";
const ISSUER_DID = process.env.VC_ISSUER_DID ?? "did:web:pamojawealth.app";
const JWK_STR = process.env.VC_PRIVATE_KEY_JWK ?? "";

interface JwsSigner {
  sign: (payload: object) => string;
  publicJwk: () => object;
}

let cachedSigner: JwsSigner | null = null;

function base64urlJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function loadSigner(): JwsSigner | null {
  if (cachedSigner) return cachedSigner;
  if (!JWK_STR) return null;
  try {
    const jwk = JSON.parse(JWK_STR) as { kty: string; crv: string; x: string; y: string; d: string };
    const keyObject = crypto.createPrivateKey({ key: jwk, format: "jwk" });
    const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, alg: "ES256", use: "sig" };
    cachedSigner = {
      sign: (payload) => {
        const header = base64urlJson({ alg: "ES256", typ: "JWT", kid: `${ISSUER_DID}#keys-1` });
        const body = base64urlJson(payload);
        const signingInput = `${header}.${body}`;
        const sig = crypto.createSign("SHA256").update(signingInput).sign({ key: keyObject, dsaEncoding: "ieee-p1363" });
        return `${signingInput}.${sig.toString("base64url")}`;
      },
      publicJwk: () => publicJwk,
    };
    return cachedSigner;
  } catch (err) {
    logger.warn({ err }, "vc-signer: failed to load VC_PRIVATE_KEY_JWK");
    return null;
  }
}

function buildVc(subjectDid: string, credentialType: string, credentialSubject: Record<string, unknown>): object {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 90 * 24 * 60 * 60; // 90 days
  return {
    iss: ISSUER_DID,
    sub: subjectDid,
    nbf: now,
    iat: now,
    exp: now + expiresIn,
    jti: `urn:uuid:${crypto.randomUUID()}`,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", credentialType],
      issuer: { id: ISSUER_DID, url: ISSUER_URL },
      issuanceDate: new Date(now * 1000).toISOString(),
      expirationDate: new Date((now + expiresIn) * 1000).toISOString(),
      credentialSubject: { id: subjectDid, ...credentialSubject },
    },
  };
}

function subjectDid(userId: string): string {
  return `did:pamoja:user:${userId}`;
}

export async function issueMembershipCredential(userId: string, chamaId: string): Promise<string> {
  const signer = loadSigner();
  if (!signer) throw new Error("VC signing disabled (VC_PRIVATE_KEY_JWK unset)");
  const m = await prisma.membership.findFirst({
    where: { userId, chamaId, status: "active" },
    select: { role: true, joinedAt: true, chama: { select: { name: true, id: true } } },
  });
  if (!m) throw new Error("Not an active member of this chama");
  return signer.sign(buildVc(subjectDid(userId), "MembershipCredential", {
    chamaId: m.chama.id,
    chamaName: m.chama.name,
    role: m.role,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

export async function issueTrustScoreCredential(userId: string): Promise<string> {
  const signer = loadSigner();
  if (!signer) throw new Error("VC signing disabled");
  const t = await getTrustScore(userId);
  return signer.sign(buildVc(subjectDid(userId), "TrustScoreCredential", {
    score: t.score,
    band: t.band,
    computedAt: t.computedAt,
  }));
}

export async function issueKycCredential(userId: string): Promise<string> {
  const signer = loadSigner();
  if (!signer) throw new Error("VC signing disabled");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycTier: true, lastKycAt: true, isVerified: true },
  });
  if (!u) throw new Error("User not found");
  return signer.sign(buildVc(subjectDid(userId), "KycCredential", {
    tier: u.kycTier ?? (u.isVerified ? 2 : 0),
    verifiedAt: u.lastKycAt?.toISOString() ?? null,
  }));
}

export function publicJwks(): { keys: object[] } {
  const signer = loadSigner();
  if (!signer) return { keys: [] };
  return { keys: [signer.publicJwk()] };
}
