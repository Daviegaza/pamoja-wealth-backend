import axios from "axios";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";

const MPESA_TOKEN_KEY = "mpesa:access_token";
const TOKEN_BUFFER = 60; // Refresh 60s before expiry

function getBaseUrl() {
  return config.mpesa.environment === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getAccessToken(): Promise<string> {
  const cached = await redis.get(MPESA_TOKEN_KEY);
  if (cached) return cached;

  if (!config.mpesa.consumerKey || !config.mpesa.consumerSecret) {
    throw new Error("M-Pesa credentials not configured");
  }

  const auth = Buffer.from(
    `${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`
  ).toString("base64");

  const response = await axios.get(
    `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  const token = response.data.access_token;
  const expiresIn = parseInt(response.data.expires_in, 10) - TOKEN_BUFFER;
  await redis.set(MPESA_TOKEN_KEY, token, "EX", expiresIn);
  return token;
}

function generatePassword(): string {
  const timestamp = getTimestamp();
  return Buffer.from(
    `${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`
  ).toString("base64");
}

function getTimestamp(): string {
  const now = new Date();
  return (
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0")
  );
}

export async function stkPush(
  phone: string,
  amount: number,
  accountRef: string
): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  if (!config.features.mpesa) {
    logger.info({ phone, amount }, "DEV: M-Pesa STK Push (not sent — feature disabled)");
    return { checkoutRequestId: "mock_" + Date.now(), merchantRequestId: "mock_merchant_" + Date.now() };
  }

  const token = await getAccessToken();
  const response = await axios.post(
    `${getBaseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: config.mpesa.shortcode,
      Password: generatePassword(),
      Timestamp: getTimestamp(),
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(amount),
      PartyA: phone.replace(/^0/, "254").replace(/^\+/, "").replace(/\s/g, ""),
      PartyB: config.mpesa.shortcode,
      PhoneNumber: phone.replace(/^0/, "254").replace(/^\+/, "").replace(/\s/g, ""),
      CallBackURL: `${config.mpesa.callbackBase}/deposit/mpesa-callback`,
      AccountReference: accountRef,
      TransactionDesc: "Pamoja Wealth deposit",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return {
    checkoutRequestId: response.data.CheckoutRequestID,
    merchantRequestId: response.data.MerchantRequestID,
  };
}

export async function stkPushCallback(body: any): Promise<{
  success: boolean;
  receipt?: string;
  phone?: string;
  amount?: number;
  reference?: string;
}> {
  const result = body.Body?.stkCallback;
  if (!result) return { success: false };

  const success = result.ResultCode === 0;
  if (!success) return { success: false };

  const items = result.CallbackMetadata?.Item || [];
  const getValue = (name: string) => items.find((i: any) => i.Name === name)?.Value;

  return {
    success: true,
    receipt: getValue("MpesaReceiptNumber"),
    phone: getValue("PhoneNumber")?.toString(),
    amount: getValue("Amount") ? Number(getValue("Amount")) : undefined,
    reference: body.Body?.stkCallback?.CheckoutRequestID,
  };
}

export async function b2cPayment(
  phone: string,
  amount: number,
  remarks: string
): Promise<{ conversationId: string }> {
  if (!config.features.mpesa) {
    logger.info({ phone, amount }, "DEV: M-Pesa B2C (not sent)");
    return { conversationId: "mock_b2c_" + Date.now() };
  }

  const token = await getAccessToken();
  const response = await axios.post(
    `${getBaseUrl()}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName: "testapi",
      SecurityCredential: "placeholder",
      CommandID: "BusinessPayment",
      Amount: Math.round(amount),
      PartyA: config.mpesa.shortcode,
      PartyB: phone.replace(/^0/, "254").replace(/^\+/, "").replace(/\s/g, ""),
      Remarks: remarks,
      QueueTimeOutURL: `${config.mpesa.callbackBase}/b2c-timeout`,
      ResultURL: `${config.mpesa.callbackBase}/withdraw/b2c-callback`,
      Occasion: "Pamoja Wealth withdrawal",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return { conversationId: response.data.ConversationID };
}

export async function transactionStatus(
  transactionId: string
): Promise<{ status: string; receipt?: string }> {
  if (!config.features.mpesa) {
    return { status: "completed" };
  }

  const token = await getAccessToken();
  const response = await axios.post(
    `${getBaseUrl()}/mpesa/transactionstatus/v1/query`,
    {
      Initiator: "testapi",
      SecurityCredential: "placeholder",
      CommandID: "TransactionStatusQuery",
      TransactionID: transactionId,
      IdentifierType: "1",
      ResultURL: `${config.mpesa.callbackBase}/status-callback`,
      QueueTimeOutURL: `${config.mpesa.callbackBase}/status-timeout`,
      Remarks: "Status query",
      Occasion: "",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return { status: "pending" };
}

// ── Public initiate / handleCallback aliases ────────────────────────
//
// Aliased wrappers expected by `contribute.service.ts` and the polling job.
// `initiate` is the canonical name in CONTRIBUTE wiring; `stkPush` is the
// historical name that wallet.service still uses.

export async function initiate(
  phone: string,
  amount: number,
  accountReference: string,
  _transactionDesc?: string,
): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
  return stkPush(phone, amount, accountReference);
}

// ── STK Push status query (CheckoutRequestID, not B2C TransactionID) ──
//
// Used by the `stk-status-poll` scheduler to recover from a missed STK
// callback ("phantom contribution"). Daraja docs:
//   POST /mpesa/stkpushquery/v1/query
//   Body: { BusinessShortCode, Password, Timestamp, CheckoutRequestID }
//
// Returns the same ResultCode semantics as the callback — 0 = success,
// otherwise a numeric failure code.
export interface StkStatusResponse {
  resultCode: number;
  resultDesc: string;
  // Present when ResultCode === 0:
  mpesaReceiptNumber?: string;
  amount?: number;
  phoneNumber?: string;
  transactionDate?: string;
}

export async function queryStkStatus(checkoutRequestId: string): Promise<StkStatusResponse> {
  if (!config.features.mpesa) {
    return { resultCode: 1037, resultDesc: "DEV: feature disabled" };
  }

  const token = await getAccessToken();
  try {
    const response = await axios.post(
      `${getBaseUrl()}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: config.mpesa.shortcode,
        Password: generatePassword(),
        Timestamp: getTimestamp(),
        CheckoutRequestID: checkoutRequestId,
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = response.data ?? {};
    const resultCode = Number(data.ResultCode ?? data.ResponseCode ?? -1);
    return {
      resultCode,
      resultDesc: String(data.ResultDesc ?? data.ResponseDescription ?? ""),
      // STK status query doesn't return CallbackMetadata — receipt comes
      // from the callback (or via a separate transactionStatus call).
    };
  } catch (err) {
    const status = (err as { response?: { data?: { errorCode?: string; errorMessage?: string } } })?.response?.data;
    // Daraja returns 500.001.1001 when the transaction is still being processed.
    const errCode = status?.errorCode ?? "";
    const errMsg = status?.errorMessage ?? (err as Error).message;
    if (errCode.includes("500.001.1001") || errMsg.includes("being processed")) {
      return { resultCode: 1037, resultDesc: "Transaction still being processed" };
    }
    throw err;
  }
}

// ── handleCallback: shared by webhook + status poller ────────────────
//
// Centralises STK callback semantics so the same logic runs whether the
// payload arrives via Safaricom POST or via our backfill poller. Performs
// the lookup, ledger post, and Socket.io emit. Returns a small status object
// (the webhook itself ALWAYS returns 200 to Safaricom; the caller decides).
export interface HandleCallbackResult {
  matched: boolean;
  transactionId?: string;
  status?: "completed" | "failed";
  reason?: string;
}

export function getMeta(items: Array<{ Name?: string; Value?: unknown }>, name: string): unknown {
  if (!Array.isArray(items)) return undefined;
  return items.find((i) => i?.Name === name)?.Value;
}

export async function handleCallback(payload: unknown): Promise<HandleCallbackResult> {
  // Lazy import to avoid circular dep with contribute service.
  const { processStkCallback } = await import("./stk-callback.service.js");
  return processStkCallback(payload);
}
