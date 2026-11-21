import dotenv from "dotenv";
dotenv.config();

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

/**
 * Secrets have NO fallback in production: the process refuses to start if
 * they are missing or weak. Development/test get clearly-labelled dev values
 * so local runs work without a .env file.
 */
function secret(name: string, devFallback: string, validate?: (v: string) => string | null): string {
  const value = process.env[name];
  if (value && value.length > 0) {
    const problem = validate?.(value) ?? null;
    if (problem) {
      throw new Error(`Invalid ${name}: ${problem}`);
    }
    return value;
  }
  if (isProduction) {
    throw new Error(`${name} must be set in production`);
  }
  return devFallback;
}

const minLength = (n: number) => (v: string) =>
  v.length < n ? `must be at least ${n} characters` : null;

// AES-256-GCM needs a 32-byte key = 64 hex characters.
const hex32Bytes = (v: string) =>
  /^[0-9a-fA-F]{64}$/.test(v) ? null : "must be 64 hex characters (32 bytes)";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv,
  isProduction,
  apiUrl: process.env.API_URL || "http://localhost:3000",
  // Where the web app lives; used for payment-provider redirect URLs.
  appUrl: process.env.APP_URL || "http://localhost:5173",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),
  // Number of reverse proxies in front of the app (Fly.io = 1). Used for
  // Express "trust proxy" so req.ip is the real client, not a spoofable
  // left-most X-Forwarded-For entry.
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || (isProduction ? "1" : "0"), 10),

  database: {
    url: secret("DATABASE_URL", "postgresql://pamoja:pamoja@localhost:5432/pamoja"),
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || "2", 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || "20", 10),
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  jwt: {
    secret: secret("JWT_SECRET", "dev-only-access-secret-not-for-production-use", minLength(32)),
    refreshSecret: secret("JWT_REFRESH_SECRET", "dev-only-refresh-secret-not-for-production-use", minLength(32)),
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",
    refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL_SECONDS || String(7 * 24 * 3600), 10),
  },

  // SaaS subscription billing ONLY. These providers collect the chama's
  // subscription fee for Pamoja; they are never used for member money.
  flutterwave: {
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
    baseUrl: process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    baseUrl: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  },

  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || "",
    from: process.env.EMAIL_FROM || "noreply@pamojawealth.com",
  },

  africastalking: {
    username: process.env.AT_USERNAME || "sandbox",
    apiKey: process.env.AT_API_KEY || "",
    senderId: process.env.AT_SENDER_ID || "Pamoja",
  },

  encryption: {
    key: secret("ENCRYPTION_KEY", "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", hex32Bytes),
  },

  metrics: {
    // In production /metrics requires `Authorization: Bearer <METRICS_TOKEN>`;
    // without a token configured the endpoint is disabled.
    token: process.env.METRICS_TOKEN || "",
  },
};
