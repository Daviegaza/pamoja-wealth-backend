/**
 * ESM Jest config (the Prisma 7 generated client is ESM-only).
 * Run via `npm test` which sets --experimental-vm-modules.
 *
 * Integration tests need a real Postgres + Redis:
 *   TEST_DATABASE_URL (default postgresql://pamoja:test@127.0.0.1:55433/pamoja_test)
 *   TEST_REDIS_URL    (default redis://127.0.0.1:56379)
 * tests/global-setup.ts applies all Prisma migrations before the run.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\.{1,2}/.*)\.js$": "$1",
  },
  transform: {
    "^.+\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  globalSetup: "<rootDir>/tests/global-setup.ts",
  testTimeout: 30000,
};
