import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  apiUrl: process.env.API_URL || "http://localhost:3000",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173").split(","),

  database: {
    url: process.env.DATABASE_URL || "postgresql://pamoja:pamoja@localhost:5432/pamoja",
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || "2", 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || "20", 10),
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-in-production-min-32-chars",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-in-production",
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",
  },

  mpesa: {
    consumerKey: process.env.MPESA_CONSUMER_KEY || "",
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || "",
    passkey: process.env.MPESA_PASSKEY || "",
    shortcode: process.env.MPESA_SHORTCODE || "174379",
    tillNumber: process.env.MPESA_TILL_NUMBER || "",
    environment: process.env.MPESA_ENVIRONMENT || "sandbox",
    callbackBase: process.env.MPESA_CALLBACK_BASE || "http://localhost:3000/api/v1/wallet",
  },

  flutterwave: {
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY || "",
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY || "",
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY || "",
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
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

  fcm: {
    serverKey: process.env.FCM_SERVER_KEY || "",
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || "",
    accessKey: process.env.S3_ACCESS_KEY || "",
    secretKey: process.env.S3_SECRET_KEY || "",
    bucket: process.env.S3_BUCKET || "pamoja-documents",
    region: process.env.S3_REGION || "us-east-1",
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef",
  },

  features: {
    chat: process.env.FEATURE_CHAT_ENABLED !== "false",
    ai: process.env.FEATURE_AI_ENABLED === "true",
    mpesa: process.env.FEATURE_MPESA_ENABLED === "true",
    investments: process.env.FEATURE_INVESTMENTS_ENABLED !== "false",
  },
};
