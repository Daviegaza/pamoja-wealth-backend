import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "child_process";

/** Imports the config module in a fresh process with exactly `env`. */
function loadConfig(env: Record<string, string>) {
  const base: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (process.env.SystemRoot) base.SystemRoot = process.env.SystemRoot;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", "await import('./src/config/index.ts')"], {
    env: { ...base, ...env },
    encoding: "utf8",
    cwd: process.cwd(),
  });
}

const good: Record<string, string> = {
  DATABASE_URL: "postgresql://u:p@db:5432/x",
  JWT_SECRET: "x".repeat(40),
  JWT_REFRESH_SECRET: "y".repeat(40),
  ENCRYPTION_KEY: "cd".repeat(32),
};

describe("production config fails fast", () => {
  it("starts with all secrets set", () => {
    const r = loadConfig({ NODE_ENV: "production", ...good });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.each(["JWT_SECRET", "JWT_REFRESH_SECRET", "ENCRYPTION_KEY", "DATABASE_URL"])("refuses to start without %s", (name) => {
    const env: Record<string, string> = { NODE_ENV: "production", ...good };
    delete env[name];
    const r = loadConfig(env);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(name);
  });

  it("rejects a short JWT secret and a 16-byte encryption key", () => {
    expect(loadConfig({ NODE_ENV: "production", ...good, JWT_SECRET: "short" }).status).not.toBe(0);
    expect(loadConfig({ NODE_ENV: "production", ...good, ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" }).status).not.toBe(0);
  });
});
