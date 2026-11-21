// Runs in every test worker before modules load: point config at the
// throwaway test services and use deterministic test secrets.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://pamoja:test@127.0.0.1:55433/pamoja_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379";
process.env.JWT_SECRET = "test-access-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-at-least-32-characters-long";
process.env.ENCRYPTION_KEY = "ab".repeat(32);
process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-dummy";
process.env.FLUTTERWAVE_WEBHOOK_SECRET = "flw-webhook-secret";
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";
process.env.APP_URL = "http://localhost:5173";
