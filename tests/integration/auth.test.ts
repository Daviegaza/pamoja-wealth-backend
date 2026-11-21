import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { api, closeConnections, prisma, resetDb } from "../helpers.js";

const creds = { email: "Wanjiru@Example.test", phone: "+254711000111", fullName: "Wanjiru K", password: "Str0ngPassw0rd" };

beforeAll(resetDb);
afterAll(closeConnections);

describe("auth and refresh-token revocation", () => {
  let refreshToken: string;
  let accessToken: string;

  it("registers without creating any wallet/custody record", async () => {
    const res = await api().post("/api/v1/auth/register").send(creds);
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe("wanjiru@example.test");
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM wallets`;
    expect(Number(rows[0].n)).toBe(0);
  });

  it("logs in (email is case-insensitive)", async () => {
    const res = await api().post("/api/v1/auth/login").send({ email: "WANJIRU@example.test", password: creds.password });
    expect(res.status).toBe(200);
    refreshToken = res.body.data.refreshToken;
    accessToken = res.body.data.accessToken;
  });

  it("refresh tokens are single-use; replay revokes every session", async () => {
    const first = await api().post("/api/v1/auth/refresh").send({ refreshToken });
    expect(first.status).toBe(200);
    const rotated = first.body.data.refreshToken;

    const replay = await api().post("/api/v1/auth/refresh").send({ refreshToken });
    expect(replay.status).toBe(401);

    // The replay is treated as theft: the legitimately rotated token is gone too.
    const afterTheft = await api().post("/api/v1/auth/refresh").send({ refreshToken: rotated });
    expect(afterTheft.status).toBe(401);
  });

  it("logout revokes the presented refresh token", async () => {
    const login = await api().post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const { accessToken: at, refreshToken: rt } = login.body.data;
    expect((await api().post("/api/v1/auth/logout").set("Authorization", `Bearer ${at}`).send({ refreshToken: rt })).status).toBe(200);
    expect((await api().post("/api/v1/auth/refresh").send({ refreshToken: rt })).status).toBe(401);
  });

  it("a refresh token cannot be used as an access token", async () => {
    const login = await api().post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const res = await api().get("/api/v1/users/me").set("Authorization", `Bearer ${login.body.data.refreshToken}`);
    expect(res.status).toBe(401);
    expect((await api().get("/api/v1/users/me").set("Authorization", `Bearer ${accessToken}`)).status).toBe(200);
  });

  it("removed product areas are gone from the API", async () => {
    const login = await api().post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const h = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const paths = [
      "/api/v1/wallet",
      "/api/v1/wallet/withdraw",
      "/api/v1/investments",
      "/api/v1/payouts/x",
      "/api/v1/loans",
      "/api/v1/public/invest/x",
      "/api/v1/webhooks/c2b/confirmation",
    ];
    for (const path of paths) {
      const res = await api().get(path).set(h);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });
});
