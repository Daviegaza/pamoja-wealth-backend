import { Response, NextFunction, Request } from "express";
import * as walletService from "../services/wallet.service.js";
import * as mpesaService from "../services/mpesa.service.js";
import { processStkCallback } from "../services/stk-callback.service.js";
import { success, paginated } from "../utils/api-response.js";
import { logger } from "../config/logger.js";

export async function deposit(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.deposit(
      req.user!.userId,
      req.body.amount,
      req.body.method,
      req.body.chamaId
    );

    // Initiate M-Pesa push if applicable
    if (req.body.method === "mpesa") {
      try {
        const mpesaResult = await mpesaService.stkPush(
          req.body.destination || "",
          req.body.amount,
          result.transaction.reference
        );
        logger.info({ mpesaResult }, "M-Pesa STK push initiated");
      } catch (err) {
        logger.error({ err }, "M-Pesa STK push failed");
      }
    }

    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function mpesaCallback(req: Request, res: Response, _next: NextFunction) {
  // Per Daraja contract — ALWAYS return ResultCode:0 to Safaricom, regardless
  // of internal success/failure. Errors are logged and retried out-of-band.
  // The wallet-level processor is kept for legacy plain-deposit flows; the
  // chama/harambee processor runs first because it owns the new
  // mpesaCheckoutRequestId column.
  try {
    const result = await processStkCallback(req.body);
    if (!result.matched) {
      // Fall back to the legacy walletService processor — it looks up by
      // `reference` rather than `mpesaCheckoutRequestId`.
      try {
        await walletService.processMpesaCallback(req.body);
      } catch (err) {
        logger.warn({ err }, "mpesaCallback: legacy processor also failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "mpesaCallback: processing error — returning Success to Safaricom anyway");
  }
  res.status(200).json({ ResultCode: 0, ResultDesc: "Success" });
}

export async function withdraw(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.withdraw(
      req.user!.userId,
      req.body.amount,
      req.body.method,
      req.body.destination
    );

    if (req.body.method === "mpesa") {
      try {
        await mpesaService.b2cPayment(
          req.body.destination,
          req.body.amount,
          `Withdrawal ref: ${result.transaction.reference}`
        );
      } catch (err) {
        logger.error({ err }, "M-Pesa B2C failed");
      }
    }

    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function getWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.getWallet(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const days = parseInt((req.query.days as string) || "90", 10);
    const history = await walletService.getHistory(req.user!.userId, days);
    success(res, { history });
  } catch (err) {
    next(err);
  }
}

export async function getTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.getTransactions(req.user!.userId, req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) {
    next(err);
  }
}

export async function addBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.addBankAccount(req.user!.userId, req.body);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function getBankAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const accounts = await walletService.getBankAccounts(req.user!.userId);
    success(res, { accounts });
  } catch (err) {
    next(err);
  }
}

export async function removeBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.removeBankAccount(req.user!.userId, req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function addMpesaAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.addMpesaAccount(req.user!.userId, req.body);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function getMpesaAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const accounts = await walletService.getMpesaAccounts(req.user!.userId);
    success(res, { accounts });
  } catch (err) {
    next(err);
  }
}

export async function removeMpesaAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await walletService.removeMpesaAccount(req.user!.userId, req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function setDefaultBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const account = await walletService.setDefaultBankAccount(req.user!.userId, req.params.id);
    success(res, account);
  } catch (err) {
    next(err);
  }
}

export async function setDefaultMpesaAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const account = await walletService.setDefaultMpesaAccount(req.user!.userId, req.params.id);
    success(res, account);
  } catch (err) {
    next(err);
  }
}
