import { Router, raw } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { darajaGuard } from "../middleware/webhook-guard.js";
import {
  depositSchema, withdrawSchema, addBankAccountSchema,
  addMpesaAccountSchema, transactionQuerySchema, walletHistoryQuerySchema,
} from "../validators/wallet.schema.js";
import * as wallet from "../controllers/wallet.controller.js";
import { handleB2CResult, handleB2CTimeout } from "../services/b2c-callback.service.js";
import { logger } from "../config/logger.js";

const router = Router();

// M-Pesa STK-Push callback. Guarded by IP-allowlist + secret-path token
// (see middleware/webhook-guard.ts). Raw body preserved so downstream can
// hash the exact bytes Safaricom sent.
router.post("/deposit/mpesa-callback/:secret?", darajaGuard, raw({ type: "application/json" }), (req, res, next) => {
  try {
    req.body = JSON.parse(req.body.toString());
  } catch {
    req.body = {};
  }
  wallet.mpesaCallback(req, res, next);
});

// M-Pesa B2C ResultURL — Safaricom POSTs final settlement outcome here.
// Always ACK 200 immediately (Safaricom retries aggressively on non-200s).
router.post("/withdraw/b2c-callback", darajaGuard, raw({ type: "application/json" }), (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
  let body: unknown;
  try { body = JSON.parse(req.body.toString()); } catch { body = {}; }
  handleB2CResult(body as Parameters<typeof handleB2CResult>[0]).catch((err) => {
    logger.error({ err }, "b2c-callback processing failed");
  });
});

// M-Pesa B2C QueueTimeoutURL — fires if the request never settled.
router.post("/b2c-timeout", darajaGuard, raw({ type: "application/json" }), (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
  let body: unknown;
  try { body = JSON.parse(req.body.toString()); } catch { body = {}; }
  handleB2CTimeout(body as Parameters<typeof handleB2CTimeout>[0]).catch((err) => {
    logger.error({ err }, "b2c-timeout processing failed");
  });
});

router.post("/deposit", authenticate, validate(depositSchema), wallet.deposit);
router.post("/withdraw", authenticate, validate(withdrawSchema), wallet.withdraw);
router.get("/", authenticate, wallet.getWallet);
router.get("/history", authenticate, validate(walletHistoryQuerySchema, "query"), wallet.getHistory);
router.get("/transactions", authenticate, validate(transactionQuerySchema, "query"), wallet.getTransactions);
router.post("/bank-accounts", authenticate, validate(addBankAccountSchema), wallet.addBankAccount);
router.get("/bank-accounts", authenticate, wallet.getBankAccounts);
router.delete("/bank-accounts/:id", authenticate, wallet.removeBankAccount);
router.post("/bank-accounts/:id/default", authenticate, wallet.setDefaultBankAccount);
router.post("/mpesa-accounts", authenticate, validate(addMpesaAccountSchema), wallet.addMpesaAccount);
router.get("/mpesa-accounts", authenticate, wallet.getMpesaAccounts);
router.delete("/mpesa-accounts/:id", authenticate, wallet.removeMpesaAccount);
router.post("/mpesa-accounts/:id/default", authenticate, wallet.setDefaultMpesaAccount);

// Multi-currency balance snapshot for the authenticated user.
import { balancesForUserByCurrency } from "../services/ledger.service.js";
import { success } from "../utils/api-response.js";
router.get("/balances", authenticate, async (req, res, next) => {
  try {
    const rows = await balancesForUserByCurrency(req.user!.userId);
    success(res, rows);
  } catch (err) { next(err); }
});

export default router;
