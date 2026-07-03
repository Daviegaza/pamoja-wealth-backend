import { Router, raw } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { darajaGuard } from "../middleware/webhook-guard.js";
import {
  depositSchema, withdrawSchema, addBankAccountSchema,
  addMpesaAccountSchema, transactionQuerySchema, walletHistoryQuerySchema,
} from "../validators/wallet.schema.js";
import * as wallet from "../controllers/wallet.controller.js";

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

export default router;
