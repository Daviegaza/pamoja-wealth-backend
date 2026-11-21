import { execSync } from "child_process";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://pamoja:test@127.0.0.1:55433/pamoja_test";
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
