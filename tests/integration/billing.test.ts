import crypto from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { api, auth, closeConnections, createChama, createUser, prisma, resetDb, type TestUser } from "../helpers.js";
import { providerClient, type VerifiedPayment } from "../../src/services/payment-providers.js";

/**
 * Subscription activation must only happen after a server-side verify call to
 * the provider confirms success + KES + amount >= invoice total. Redirect
 * params and webhook bodies alone must never activate anything.
 */

let chair: TestUser, treasurer: TestUser, member: TestUser, outsiderChair: TestUser;
let chamaId: string, otherChamaId: string;
const url = (path: string) => `/api/v1/chamas/${chamaId}${path}`;

function verified(over: Partial<VerifiedPayment>): VerifiedPayment {
  return {
    successful: true,
    failed: false,
    amountKes: 499,
    currency: "KES",
    reference: "",
    providerTransactionId: "tx-1",
    rawStatus: "successful",
    ...over,
  };
}

async function startCheckout(provider: "flutterwave" | "paystack" = "flutterwave") {
  const res = await api().post(url("/subscription/checkout")).set(auth(treasurer)).send({ planCode: "starter", cadence: "monthly", provider });
  expect(res.status).toBe(201);
  return res.body.data as { invoiceId: string; reference: string; checkoutUrl: string };
}

const planOf = async () => (await prisma.chama.findUniqueOrThrow({ where: { id: chamaId } })).currentPlanCode;

beforeAll(async () => {
  await resetDb();
  [chair, treasurer, member, outsiderChair] = await Promise.all(["Chair", "Treasurer", "Member", "OtherChair"].map(createUser));
  chamaId = await createChama(chair, [{ user: treasurer, role: "treasurer" }, { user: member, role: "member" }]);
  otherChamaId = await createChama(outsiderChair, [], "Other");
  jest.spyOn(providerClient, "initCheckout").mockImplementation(async (input) => `https://checkout.example/${input.reference}`);
});

afterEach(() => {
  jest.mocked(providerClient.verifyPayment).mockReset?.();
});

afterAll(async () => {
  jest.restoreAllMocks();
  await closeConnections();
});

describe("checkout", () => {
  it("creates an open invoice and returns the provider checkout URL", async () => {
    const co = await startCheckout();
    expect(co.checkoutUrl).toBe(`https://checkout.example/${co.reference}`);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: co.invoiceId } });
    expect(inv.status).toBe("open");
    expect(Number(inv.totalKes)).toBe(499);
    expect(await planOf()).toBe("free");
  });

  it("starts the provider checkout with the server-side plan price, not a client amount", async () => {
    const res = await api().post(url("/subscription/checkout")).set(auth(treasurer)).send({ planCode: "starter", provider: "paystack", amount: 1 });
    expect(res.status).toBe(400); // unknown field rejected
  });
});

describe("verification before activation", () => {
  it("does NOT activate while the provider says the payment is pending", async () => {
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ successful: false, rawStatus: "pending", reference: co.reference }));
    const res = await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ activated: false, reason: "pending" });
    expect(await planOf()).toBe("free");
  });

  it("does NOT activate when the provider amount is lower than the invoice", async () => {
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ amountKes: 49, reference: co.reference }));
    const res = await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference });
    expect(res.body.data).toMatchObject({ activated: false, reason: "mismatch" });
    expect(await planOf()).toBe("free");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: co.invoiceId } })).status).toBe("open");
    expect(await prisma.auditLog.count({ where: { chamaId, action: "subscription.verification_mismatch" } })).toBe(1);
  });

  it("does NOT activate on wrong currency or a different reference", async () => {
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValueOnce(verified({ currency: "USD", reference: co.reference }));
    expect((await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference })).body.data.activated).toBe(false);
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValueOnce(verified({ reference: "PWSUBSOMEONEELSE" }));
    expect((await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference })).body.data.activated).toBe(false);
    expect(await planOf()).toBe("free");
  });

  it("marks the invoice failed when the provider reports failure", async () => {
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ successful: false, failed: true, rawStatus: "failed", reference: co.reference }));
    const res = await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference });
    expect(res.body.data).toMatchObject({ activated: false, reason: "failed" });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: co.invoiceId } })).status).toBe("failed");
  });

  it("members of another chama cannot verify (or probe) this chama's invoice", async () => {
    const co = await startCheckout();
    const spy = jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ reference: co.reference }));
    const res = await api().post(`/api/v1/chamas/${otherChamaId}/subscription/verify`).set(auth(outsiderChair)).send({ reference: co.reference });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("activates only after a verified, matching payment — and only once", async () => {
    const co = await startCheckout();
    const spy = jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ reference: co.reference, amountKes: 499 }));
    const res = await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ activated: true, alreadyProcessed: false });
    expect(res.body.data.subscription).toMatchObject({ planCode: "starter", status: "active", memberCap: 30 });
    expect(spy).toHaveBeenCalledWith("flutterwave", co.reference);
    expect(await planOf()).toBe("starter");

    const again = await api().post(url("/subscription/verify")).set(auth(member)).send({ reference: co.reference });
    expect(again.body.data).toMatchObject({ activated: true, alreadyProcessed: true });
    expect(await prisma.auditLog.count({ where: { chamaId, action: "subscription.activated" } })).toBe(1);
  });
});

describe("webhooks never trust the body", () => {
  // Strings, not Buffers: superagent would JSON-encode a Buffer body.
  const flwBody = (ref: string) => JSON.stringify({ event: "charge.completed", data: { tx_ref: ref, status: "successful", amount: 499, currency: "KES" } });

  it("rejects Flutterwave webhooks without the shared secret", async () => {
    const res = await api().post("/api/v1/webhooks/flutterwave").set("Content-Type", "application/json").send(flwBody("PWSUBX"));
    expect(res.status).toBe(401);
  });

  it("a signed webhook claiming success does not activate if the provider verify says otherwise", async () => {
    await resetPlanToFree();
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ successful: false, failed: true, rawStatus: "failed", reference: co.reference }));
    const res = await api()
      .post("/api/v1/webhooks/flutterwave")
      .set("Content-Type", "application/json")
      .set("verif-hash", "flw-webhook-secret")
      .send(flwBody(co.reference));
    expect(res.status).toBe(200);
    expect(providerClient.verifyPayment).toHaveBeenCalledWith("flutterwave", co.reference);
    expect(await planOf()).toBe("free");
  });

  it("a signed Paystack webhook activates after provider verification", async () => {
    await resetPlanToFree();
    const co = await startCheckout("paystack");
    jest.spyOn(providerClient, "verifyPayment").mockResolvedValue(verified({ reference: co.reference, rawStatus: "success" }));
    const body = JSON.stringify({ event: "charge.success", data: { reference: co.reference, amount: 1, currency: "KES" } });
    const unsigned = await api().post("/api/v1/webhooks/paystack").set("Content-Type", "application/json").set("x-paystack-signature", "deadbeef").send(body);
    expect(unsigned.status).toBe(401);
    expect(await planOf()).toBe("free");

    const sig = crypto.createHmac("sha512", "sk_test_dummy").update(body).digest("hex");
    const res = await api().post("/api/v1/webhooks/paystack").set("Content-Type", "application/json").set("x-paystack-signature", sig).send(body);
    expect(res.status).toBe(200);
    expect(providerClient.verifyPayment).toHaveBeenCalledWith("paystack", co.reference);
    expect(await planOf()).toBe("starter");
  });

  it("returns 500 (so the provider retries) when verification cannot reach the provider", async () => {
    await resetPlanToFree();
    const co = await startCheckout();
    jest.spyOn(providerClient, "verifyPayment").mockRejectedValue(new Error("network down"));
    const res = await api()
      .post("/api/v1/webhooks/flutterwave")
      .set("Content-Type", "application/json")
      .set("verif-hash", "flw-webhook-secret")
      .send(flwBody(co.reference));
    expect(res.status).toBe(500);
    expect(await planOf()).toBe("free");
  });
});

async function resetPlanToFree() {
  const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  await prisma.subscription.update({
    where: { chamaId },
    data: { planId: free.id, currentPeriodEnd: new Date("9999-12-31T00:00:00Z") },
  });
  await prisma.chama.update({ where: { id: chamaId }, data: { currentPlanCode: "free" } });
}
