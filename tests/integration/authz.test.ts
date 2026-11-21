import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { api, auth, closeConnections, createChama, createUser, prisma, resetDb, type TestUser } from "../helpers.js";

/**
 * Per-chama authorization: a user who is not an active member of chama A must
 * get 404 on EVERY chama-A route (reads and writes), records of chama B must
 * not be reachable through chama A's URLs, and in-chama role limits return 403.
 */

let chairA: TestUser, treasurerA: TestUser, secretaryA: TestUser, memberA: TestUser, member2A: TestUser;
let chairB: TestUser, outsider: TestUser;
let chamaA: string, chamaB: string;
let contributionB: string, loanB: string, meetingB: string, goalB: string, scheduleB: string;
let loanA: string, contributionA: string;

beforeAll(async () => {
  await resetDb();
  [chairA, treasurerA, secretaryA, memberA, member2A, chairB, outsider] = await Promise.all(
    ["ChairA", "TreasurerA", "SecretaryA", "MemberA", "Member2A", "ChairB", "Outsider"].map(createUser),
  );
  chamaA = await createChama(chairA, [
    { user: treasurerA, role: "treasurer" },
    { user: secretaryA, role: "secretary" },
    { user: memberA, role: "member" },
  ]);
  // Free plan cap in tests is 3 members; chama A is already at 4 via direct
  // inserts, which is fine for authz tests (cap only applies to joins).
  await prisma.membership.create({ data: { chamaId: chamaA, userId: member2A.id, role: "member" } });
  chamaB = await createChama(chairB, [], "Other Chama");

  const b = (path: string) => `/api/v1/chamas/${chamaB}${path}`;
  contributionB = (await api().post(b("/contributions")).set(auth(chairB)).send({ memberId: chairB.id, amount: 500, paidOn: "2026-11-01", method: "cash" })).body.data.id;
  loanB = (await api().post(b("/loans")).set(auth(chairB)).send({ borrowerId: chairB.id, principal: 1000, issuedOn: "2026-11-01", dueDate: "2026-12-01", purpose: "School fees" })).body.data.id;
  meetingB = (await api().post(b("/meetings")).set(auth(chairB)).send({ title: "AGM", date: "2026-12-05", time: "10:00", location: "Hall" })).body.data.id;
  goalB = (await api().post(b("/goals")).set(auth(chairB)).send({ name: "Land", targetAmount: 100000, targetDate: "2027-06-30" })).body.data.id;
  scheduleB = (await api().post(b("/contribution-schedules")).set(auth(chairB)).send({ name: "Monthly", amount: 1000, frequency: "monthly", startDate: "2026-11-01" })).body.data.id;

  const a = (path: string) => `/api/v1/chamas/${chamaA}${path}`;
  loanA = (await api().post(a("/loans")).set(auth(treasurerA)).send({ borrowerId: memberA.id, principal: 2000, issuedOn: "2026-11-01", dueDate: "2026-12-01", purpose: "Stock" })).body.data.id;
  contributionA = (await api().post(a("/contributions")).set(auth(treasurerA)).send({ memberId: memberA.id, amount: 300, paidOn: "2026-11-02", method: "mpesa", mpesaReceipt: "SKA1B2C3D4" })).body.data.id;
  expect(contributionB && loanB && meetingB && goalB && scheduleB && loanA && contributionA).toBeTruthy();
});

afterAll(closeConnections);

type Method = "get" | "post" | "patch" | "put" | "delete";
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

function chamaRoutes(chamaId: string): [Method, string, object?][] {
  const p = `/api/v1/chamas/${chamaId}`;
  return [
    ["get", p],
    ["patch", p, { name: "Hijacked" }],
    ["delete", p],
    ["get", `${p}/members`],
    ["patch", `${p}/members/${ZERO_UUID}`, { role: "treasurer" }],
    ["delete", `${p}/members/${ZERO_UUID}`],
    ["get", `${p}/invite-codes`],
    ["post", `${p}/invite-codes`, {}],
    ["get", `${p}/contribution-schedules`],
    ["post", `${p}/contribution-schedules`, { name: "X", amount: 1, frequency: "monthly", startDate: "2026-11-01" }],
    ["patch", `${p}/contribution-schedules/${ZERO_UUID}`, { name: "Y" }],
    ["get", `${p}/contributions`],
    ["get", `${p}/contributions/summary`],
    ["post", `${p}/contributions`, { memberId: ZERO_UUID, amount: 1, paidOn: "2026-11-01", method: "cash" }],
    ["post", `${p}/contributions/${ZERO_UUID}/confirm`],
    ["post", `${p}/contributions/${ZERO_UUID}/dispute`, { reason: "not mine" }],
    ["post", `${p}/contributions/${ZERO_UUID}/void`, { reason: "wrong" }],
    ["get", `${p}/goals`],
    ["post", `${p}/goals`, { name: "G", targetAmount: 10, targetDate: "2027-01-01" }],
    ["patch", `${p}/goals/${ZERO_UUID}`, { name: "G2" }],
    ["delete", `${p}/goals/${ZERO_UUID}`],
    ["get", `${p}/loans`],
    ["post", `${p}/loans`, { borrowerId: ZERO_UUID, principal: 1, issuedOn: "2026-11-01", dueDate: "2026-11-02", purpose: "x x" }],
    ["get", `${p}/loans/${ZERO_UUID}`],
    ["post", `${p}/loans/${ZERO_UUID}/repayments`, { amount: 1, paidOn: "2026-11-01", method: "cash" }],
    ["patch", `${p}/loans/${ZERO_UUID}/status`, { status: "defaulted" }],
    ["get", `${p}/meetings`],
    ["post", `${p}/meetings`, { title: "M", date: "2026-12-01", time: "10:00", location: "L" }],
    ["get", `${p}/meetings/${ZERO_UUID}`],
    ["patch", `${p}/meetings/${ZERO_UUID}`, { title: "M2" }],
    ["put", `${p}/meetings/${ZERO_UUID}/minutes`, { minutes: "x" }],
    ["post", `${p}/meetings/${ZERO_UUID}/rsvp`, { status: "attending" }],
    ["get", `${p}/statements/chama`],
    ["get", `${p}/statements/members/${ZERO_UUID}`],
    ["get", `${p}/audit`],
    ["get", `${p}/subscription`],
    ["post", `${p}/subscription/checkout`, { planCode: "starter", provider: "paystack" }],
    ["post", `${p}/subscription/verify`, { reference: "PWSUBXXXXXXXX" }],
    ["post", `${p}/subscription/cancel`],
    ["get", `${p}/invoices`],
  ];
}

describe("non-members of a chama", () => {
  it("get 404 on every chama-scoped route (outsider with no chama)", async () => {
    for (const [method, path, body] of chamaRoutes(chamaA)) {
      const res = await api()[method](path).set(auth(outsider)).send(body ?? {});
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }
  });

  it("get 404 on every chama-scoped route (chairperson of ANOTHER chama)", async () => {
    for (const [method, path, body] of chamaRoutes(chamaA)) {
      const res = await api()[method](path).set(auth(chairB)).send(body ?? {});
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }
  });

  it("cannot change anything in the other chama", async () => {
    const chama = await prisma.chama.findUniqueOrThrow({ where: { id: chamaA } });
    expect(chama.name).toBe("Test Chama");
    expect(chama.status).toBe("active");
    expect(await prisma.contributionRecord.count({ where: { chamaId: chamaA } })).toBe(1);
  });

  it("removed (inactive) members lose access", async () => {
    const res = await api().delete(`/api/v1/chamas/${chamaA}/members/${member2A.id}`).set(auth(chairA));
    expect(res.status).toBe(200);
    const after = await api().get(`/api/v1/chamas/${chamaA}`).set(auth(member2A));
    expect(after.status).toBe(404);
  });

  it("unauthenticated requests get 401", async () => {
    const res = await api().get(`/api/v1/chamas/${chamaA}/contributions`);
    expect(res.status).toBe(401);
  });

  it("malformed chama ids are 404, not 500", async () => {
    const res = await api().get(`/api/v1/chamas/not-a-uuid/contributions`).set(auth(chairA));
    expect(res.status).toBe(404);
  });
});

describe("records from another chama cannot be reached through your own chama", () => {
  const a = (path: string) => `/api/v1/chamas/${chamaA}${path}`;

  it("loan, meeting, contribution, goal and schedule ids from chama B are 404 in chama A", async () => {
    const attempts: [Method, string, object?][] = [
      ["get", a(`/loans/${loanB}`)],
      ["post", a(`/loans/${loanB}/repayments`), { amount: 10, paidOn: "2026-11-05", method: "cash" }],
      ["patch", a(`/loans/${loanB}/status`), { status: "defaulted" }],
      ["get", a(`/meetings/${meetingB}`)],
      ["put", a(`/meetings/${meetingB}/minutes`), { minutes: "tampered" }],
      ["post", a(`/contributions/${contributionB}/void`), { reason: "tamper" }],
      ["patch", a(`/goals/${goalB}`), { name: "tamper" }],
      ["delete", a(`/goals/${goalB}`)],
      ["patch", a(`/contribution-schedules/${scheduleB}`), { amount: 1 }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api()[method](path).set(auth(chairA)).send(body ?? {});
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanB } });
    expect(loan.status).toBe("active");
    expect(Number(loan.amountRepaid)).toBe(0);
  });

  it("cannot record a contribution or loan for someone who is not in the chama", async () => {
    const c = await api().post(a("/contributions")).set(auth(treasurerA)).send({ memberId: chairB.id, amount: 10, paidOn: "2026-11-01", method: "cash" });
    expect(c.status).toBe(400);
    const l = await api().post(a("/loans")).set(auth(treasurerA)).send({ borrowerId: chairB.id, principal: 10, issuedOn: "2026-11-01", dueDate: "2026-11-30", purpose: "x x" });
    expect(l.status).toBe(400);
  });

  it("cannot tag a contribution with chama B's goal or schedule", async () => {
    const g = await api().post(a("/contributions")).set(auth(treasurerA)).send({ memberId: memberA.id, amount: 10, paidOn: "2026-11-01", method: "cash", goalId: goalB });
    expect(g.status).toBe(400);
    const s = await api().post(a("/contributions")).set(auth(treasurerA)).send({ memberId: memberA.id, amount: 10, paidOn: "2026-11-01", method: "cash", scheduleId: scheduleB });
    expect(s.status).toBe(400);
  });
});

describe("role limits inside a chama", () => {
  const a = (path: string) => `/api/v1/chamas/${chamaA}${path}`;

  it("plain members cannot record money, loans, meetings or change settings (403)", async () => {
    const attempts: [Method, string, object][] = [
      ["post", a("/contributions"), { memberId: memberA.id, amount: 100, paidOn: "2026-11-01", method: "cash" }],
      ["post", a("/loans"), { borrowerId: memberA.id, principal: 100, issuedOn: "2026-11-01", dueDate: "2026-12-01", purpose: "x x" }],
      ["post", a(`/loans/${loanA}/repayments`), { amount: 10, paidOn: "2026-11-05", method: "cash" }],
      ["post", a(`/contributions/${contributionA}/void`), { reason: "self-serve" }],
      ["post", a("/meetings"), { title: "M", date: "2026-12-01", time: "10:00", location: "L" }],
      ["patch", a(""), { name: "Renamed" }],
      ["patch", a(`/members/${memberA.id}`), { role: "chairperson" }],
      ["post", a("/invite-codes"), {}],
      ["post", a("/subscription/checkout"), { planCode: "starter", provider: "paystack" }],
      ["get", a("/invoices"), {}],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api()[method](path).set(auth(memberA)).send(body);
      expect({ path, method, status: res.status }).toEqual({ path, method, status: 403 });
    }
  });

  it("secretaries cannot record money; treasurers cannot change roles or write minutes", async () => {
    expect((await api().post(a("/contributions")).set(auth(secretaryA)).send({ memberId: memberA.id, amount: 100, paidOn: "2026-11-01", method: "cash" })).status).toBe(403);
    expect((await api().patch(a(`/members/${memberA.id}`)).set(auth(treasurerA)).send({ role: "treasurer" })).status).toBe(403);
    expect((await api().post(a("/meetings")).set(auth(treasurerA)).send({ title: "M", date: "2026-12-01", time: "10:00", location: "L" })).status).toBe(403);
    expect((await api().patch(a(`/loans/${loanA}/status`)).set(auth(treasurerA)).send({ status: "defaulted" })).status).toBe(403);
  });

  it("members only see their own contributions and loans", async () => {
    await api().post(a("/contributions")).set(auth(treasurerA)).send({ memberId: secretaryA.id, amount: 700, paidOn: "2026-11-03", method: "bank" });
    const mine = await api().get(a("/contributions")).set(auth(memberA));
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((c: { memberId: string }) => c.memberId === memberA.id)).toBe(true);
    // A member asking to filter by someone else still only gets their own rows.
    const sneaky = await api().get(a(`/contributions?memberId=${secretaryA.id}`)).set(auth(memberA));
    expect(sneaky.body.data.every((c: { memberId: string }) => c.memberId === memberA.id)).toBe(true);

    const officer = await api().get(a("/contributions")).set(auth(secretaryA));
    expect(officer.body.data.length).toBeGreaterThanOrEqual(2);

    const secLoans = await api().get(a("/loans")).set(auth(secretaryA));
    expect(secLoans.body.data.length).toBe(1);
    const loanAsOtherMember = await api().get(a(`/loans/${loanA}`)).set(auth(member2A));
    expect(loanAsOtherMember.status).toBe(404);
  });

  it("members can download their own statement but not someone else's", async () => {
    expect((await api().get(a(`/statements/members/${memberA.id}`)).set(auth(memberA))).status).toBe(200);
    expect((await api().get(a(`/statements/members/${secretaryA.id}`)).set(auth(memberA))).status).toBe(403);
    expect((await api().get(a(`/statements/members/${memberA.id}`)).set(auth(treasurerA))).status).toBe(200);
  });

  it("the last chairperson cannot be demoted or removed", async () => {
    expect((await api().patch(a(`/members/${chairA.id}`)).set(auth(chairA)).send({ role: "member" })).status).toBe(400);
    expect((await api().delete(a(`/members/${chairA.id}`)).set(auth(chairA))).status).toBe(400);
  });

  it("member phone numbers are only shown to officers", async () => {
    const asMember = await api().get(a("/members")).set(auth(memberA));
    expect(asMember.body.data.every((m: { phone: string | null }) => m.phone === null)).toBe(true);
    const asOfficer = await api().get(a("/members")).set(auth(secretaryA));
    expect(asOfficer.body.data.every((m: { phone: string | null }) => typeof m.phone === "string")).toBe(true);
  });
});
