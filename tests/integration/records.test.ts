import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { api, auth, closeConnections, createChama, createUser, prisma, resetDb, type TestUser } from "../helpers.js";

let chair: TestUser, treasurer: TestUser, member: TestUser, other: TestUser;
let chamaId: string;
const url = (path: string) => `/api/v1/chamas/${chamaId}${path}`;

beforeAll(async () => {
  await resetDb();
  [chair, treasurer, member, other] = await Promise.all(["Chair", "Treasurer", "Member", "Other"].map(createUser));
  chamaId = await createChama(chair, [
    { user: treasurer, role: "treasurer" },
    { user: member, role: "member" },
    { user: other, role: "member" },
  ]);
});

afterAll(closeConnections);

describe("contribution record -> confirm / dispute flow", () => {
  let recordId: string;

  it("treasurer records a contribution with an M-Pesa receipt as proof", async () => {
    const res = await api().post(url("/contributions")).set(auth(treasurer)).send({
      memberId: member.id,
      amount: 1500.5,
      paidOn: "2026-11-10",
      method: "mpesa",
      mpesaReceipt: "sgr7xk2lq1",
      note: "November",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      memberId: member.id,
      amount: 1500.5,
      paidOn: "2026-11-10",
      method: "mpesa",
      mpesaReceipt: "SGR7XK2LQ1",
      status: "recorded",
      recordedById: treasurer.id,
      recordedByName: "Treasurer",
    });
    recordId = res.body.data.id;

    const note = await prisma.notification.findFirst({ where: { userId: member.id } });
    expect(note?.title).toBe("Contribution recorded");
  });

  it("rejects a duplicate M-Pesa receipt in the same chama (409)", async () => {
    const res = await api().post(url("/contributions")).set(auth(treasurer)).send({
      memberId: other.id, amount: 100, paidOn: "2026-11-10", method: "mpesa", mpesaReceipt: "SGR7XK2LQ1",
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid input (future date, negative, 3 decimals, bad receipt)", async () => {
    const base = { memberId: member.id, paidOn: "2026-11-10", method: "cash", amount: 10 };
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const body of [
      { ...base, paidOn: future },
      { ...base, amount: -5 },
      { ...base, amount: 10.123 },
      { ...base, paidOn: "2026-02-30" },
      { ...base, method: "mpesa", mpesaReceipt: "no!" },
      { ...base, extra: "field" },
    ]) {
      const res = await api().post(url("/contributions")).set(auth(treasurer)).send(body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
  });

  it("only the member the payment belongs to can confirm it", async () => {
    expect((await api().post(url(`/contributions/${recordId}/confirm`)).set(auth(treasurer))).status).toBe(403);
    expect((await api().post(url(`/contributions/${recordId}/confirm`)).set(auth(other))).status).toBe(403);
    expect((await api().post(url(`/contributions/${recordId}/confirm`)).set(auth(chair))).status).toBe(403);

    const res = await api().post(url(`/contributions/${recordId}/confirm`)).set(auth(member));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("confirmed");
    expect(res.body.data.confirmedAt).toBeTruthy();
  });

  it("the member can dispute an entry with a reason; others cannot", async () => {
    const created = await api().post(url("/contributions")).set(auth(treasurer)).send({
      memberId: member.id, amount: 900, paidOn: "2026-11-11", method: "cash",
    });
    const id = created.body.data.id;
    expect((await api().post(url(`/contributions/${id}/dispute`)).set(auth(other)).send({ reason: "not me" })).status).toBe(403);
    expect((await api().post(url(`/contributions/${id}/dispute`)).set(auth(member)).send({ reason: "" })).status).toBe(400);

    const res = await api().post(url(`/contributions/${id}/dispute`)).set(auth(member)).send({ reason: "I paid 1,000 not 900" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "disputed", disputeReason: "I paid 1,000 not 900" });

    // Officer voids the wrong entry and re-records it.
    const voided = await api().post(url(`/contributions/${id}/void`)).set(auth(treasurer)).send({ reason: "Wrong amount, re-recorded" });
    expect(voided.body.data.status).toBe("voided");
    expect((await api().post(url(`/contributions/${id}/confirm`)).set(auth(member))).status).toBe(409);
    expect((await api().post(url(`/contributions/${id}/void`)).set(auth(treasurer)).send({ reason: "again" })).status).toBe(409);
  });

  it("summary excludes voided records", async () => {
    const res = await api().get(url("/contributions/summary")).set(auth(treasurer));
    expect(res.status).toBe(200);
    expect(res.body.data.totalConfirmed).toBe(1500.5);
    expect(res.body.data.totalDisputed).toBe(0);
    expect(res.body.data.byMember).toEqual([{ memberId: member.id, fullName: "Member", total: 1500.5 }]);
  });

  it("every change is in the audit log, hash-chained", async () => {
    const res = await api().get(url("/audit?pageSize=100")).set(auth(member));
    expect(res.status).toBe(200);
    const actions = res.body.data.map((e: { action: string }) => e.action);
    for (const a of ["chama.created", "contribution.recorded", "contribution.confirmed", "contribution.disputed", "contribution.voided"]) {
      expect(actions).toContain(a);
    }
    expect(res.body.data[0]).not.toHaveProperty("ipAddress");

    const rows = await prisma.auditLog.findMany({ where: { chamaId }, orderBy: { createdAt: "asc" } });
    for (let i = 1; i < rows.length; i++) {
      expect(Buffer.from(rows[i].prevHash!).equals(Buffer.from(rows[i - 1].hash))).toBe(true);
    }
    expect(crypto.createHash("sha256").digest().length).toBe(rows[0].hash.length);
  });
});

describe("loan register", () => {
  let loanId: string;

  it("records a loan the chama gave from its own account (no platform interest)", async () => {
    const res = await api().post(url("/loans")).set(auth(treasurer)).send({
      borrowerId: member.id, principal: 10000, agreedRepayable: 11000, issuedOn: "2026-11-01", dueDate: "2027-02-01", purpose: "Shop stock",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ principal: 10000, agreedRepayable: 11000, amountRepaid: 0, balance: 11000, status: "active" });
    expect(res.body.data).not.toHaveProperty("interestRate");
    loanId = res.body.data.id;
  });

  it("rejects agreedRepayable below principal and due date before issue date", async () => {
    const bad1 = await api().post(url("/loans")).set(auth(treasurer)).send({ borrowerId: member.id, principal: 100, agreedRepayable: 50, issuedOn: "2026-11-01", dueDate: "2026-12-01", purpose: "x x" });
    const bad2 = await api().post(url("/loans")).set(auth(treasurer)).send({ borrowerId: member.id, principal: 100, issuedOn: "2026-11-01", dueDate: "2026-10-01", purpose: "x x" });
    expect([bad1.status, bad2.status]).toEqual([400, 400]);
  });

  it("records repayments, refuses overpayment, completes when fully repaid", async () => {
    const r1 = await api().post(url(`/loans/${loanId}/repayments`)).set(auth(treasurer)).send({ amount: 6000, paidOn: "2026-12-01", method: "mpesa", mpesaReceipt: "TAB1234567" });
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ amountRepaid: 6000, balance: 5000, status: "active" });

    const over = await api().post(url(`/loans/${loanId}/repayments`)).set(auth(treasurer)).send({ amount: 5000.01, paidOn: "2026-12-15", method: "cash" });
    expect(over.status).toBe(400);

    const r2 = await api().post(url(`/loans/${loanId}/repayments`)).set(auth(chair)).send({ amount: 5000, paidOn: "2027-01-15", method: "cash" });
    expect(r2.body.data).toMatchObject({ amountRepaid: 11000, balance: 0, status: "completed" });
    expect(r2.body.data.repayments).toHaveLength(2);

    const borrowerView = await api().get(url(`/loans/${loanId}`)).set(auth(member));
    expect(borrowerView.status).toBe(200);
  });

  it("statements export CSV and PDF from recorded data", async () => {
    const csv = await api().get(url(`/statements/members/${member.id}?format=csv`)).set(auth(member));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("SGR7XK2LQ1");
    expect(csv.text).toContain("Pamoja does not hold");
    expect(csv.text).not.toContain("Wrong amount"); // voided rows are excluded

    const pdf = await api().get(url("/statements/chama?format=pdf")).set(auth(member)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");

    const json = await api().get(url("/statements/chama?from=2026-11-01&to=2026-11-30")).set(auth(member));
    expect(json.body.data.totals).toEqual({ contributions: 1500.5, loansIssued: 10000, repayments: 0 });
  });
});

describe("goals, meetings and invites", () => {
  it("goal progress is derived from tagged contributions", async () => {
    const goal = await api().post(url("/goals")).set(auth(treasurer)).send({ name: "Land", targetAmount: 50000, targetDate: "2027-12-31" });
    expect(goal.status).toBe(201);
    await api().post(url("/contributions")).set(auth(treasurer)).send({ memberId: other.id, amount: 2500, paidOn: "2026-11-12", method: "bank", goalId: goal.body.data.id });
    const list = await api().get(url("/goals")).set(auth(member));
    expect(list.body.data[0]).toMatchObject({ name: "Land", currentAmount: 2500 });
  });

  it("secretary/chair keep minutes; edits are audited with the previous text", async () => {
    const m = await api().post(url("/meetings")).set(auth(chair)).send({ title: "Monthly", date: "2026-11-30", time: "14:00", location: "Church hall", agenda: ["Contributions", "Loans"] });
    expect(m.status).toBe(201);
    const id = m.body.data.id;
    await api().put(url(`/meetings/${id}/minutes`)).set(auth(chair)).send({ minutes: "First draft" });
    const edited = await api().put(url(`/meetings/${id}/minutes`)).set(auth(chair)).send({ minutes: "Final minutes" });
    expect(edited.body.data.minutes).toBe("Final minutes");
    const audit = await prisma.auditLog.findFirst({ where: { chamaId, action: "meeting.minutes_edited" } });
    expect((audit?.details as { previous: string }).previous).toBe("First draft");

    const rsvp = await api().post(url(`/meetings/${id}/rsvp`)).set(auth(member)).send({ status: "attending" });
    expect(rsvp.body.data.myRsvp).toBe("attending");
  });

  it("joining by invite code respects the plan member cap (402)", async () => {
    const code = await api().post(url("/invite-codes")).set(auth(chair)).send({ expiresInDays: 7 });
    expect(code.status).toBe(201);
    const newcomer = await createUser("Newcomer");
    // Test free plan cap is 3; chama already has 4 active members.
    const res = await api().post("/api/v1/chamas/join").set(auth(newcomer)).send({ code: code.body.data.code });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("PLAN_LIMIT_REACHED");

    const small = await createChama(newcomer, [], "Small chama");
    const smallCode = await api().post(`/api/v1/chamas/${small}/invite-codes`).set(auth(newcomer)).send({});
    const joiner = await createUser("Joiner");
    const joined = await api().post("/api/v1/chamas/join").set(auth(joiner)).send({ code: smallCode.body.data.code });
    expect(joined.status).toBe(200);
    expect(joined.body.data.myRole).toBe("member");
    expect((await api().post("/api/v1/chamas/join").set(auth(joiner)).send({ code: smallCode.body.data.code })).status).toBe(409);
    expect((await api().post("/api/v1/chamas/join").set(auth(joiner)).send({ code: "BADCODE123" })).status).toBe(404);
  });
});
