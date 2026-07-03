/**
 * Integrations Routes
 *
 * GET    /integrations                    — list integrations (query: chamaId)
 * POST   /integrations/:provider/connect  — connect (OAuth returns redirectUrl, API-key/webhook returns ok)
 * DELETE /integrations/:id                — disconnect
 *
 * OAuth completion callbacks are provider-specific and live under
 * /integrations/:provider/callback (implemented per-provider in later PRs).
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import * as integrations from "../services/integrations.service.js";
import { config } from "../config/index.js";

const router = Router();

const listSchema = z.object({
  chamaId: z.string().uuid().optional(),
});

router.get("/integrations", authenticate, validate(listSchema, "query"), async (req, res) => {
  const chamaId = (req.query.chamaId as string | undefined) ?? "";
  if (!chamaId) return success(res, []);
  const items = await integrations.listForChama(chamaId);
  success(res, items);
});

const connectSchema = z.object({
  chamaId: z.string().uuid(),
  credentials: z.record(z.string(), z.string()).optional(),
});

router.post(
  "/integrations/:provider/connect",
  authenticate,
  validate(connectSchema),
  async (req, res) => {
    const provider = req.params.provider as integrations.ProviderId;
    const { chamaId, credentials } = req.body;

    // OAuth providers → return redirect URL. Callback URL will POST back and finalize.
    const oauthProviders: integrations.ProviderId[] = ["slack", "google_calendar", "zoom", "quickbooks", "xero"];
    if (oauthProviders.includes(provider)) {
      const state = Buffer.from(JSON.stringify({ chamaId, userId: req.user!.userId })).toString("base64url");
      const redirectUrl = buildOAuthUrl(provider, state);
      return success(res, { redirectUrl, ok: false });
    }

    // API-key / webhook providers → store credentials immediately.
    if (!credentials || Object.keys(credentials).length === 0) {
      throw ApiError.validation("Credentials required");
    }
    const record = await integrations.connect(chamaId, provider, credentials);
    success(res, { ...record, ok: true });
  },
);

router.delete("/integrations/:id", authenticate, async (req, res) => {
  // id encodes chamaId+provider; simpler: pass as query for now
  const chamaId = req.query.chamaId as string;
  const provider = req.query.provider as integrations.ProviderId;
  if (!chamaId || !provider) throw ApiError.validation("chamaId and provider required");
  await integrations.disconnect(chamaId, provider);
  success(res, { ok: true });
});

function buildOAuthUrl(provider: integrations.ProviderId, state: string): string {
  const cb = `${config.apiUrl}/api/v1/integrations/${provider}/callback`;
  switch (provider) {
    case "slack":
      return `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID ?? ""}&scope=chat:write,channels:read&redirect_uri=${encodeURIComponent(cb)}&state=${state}`;
    case "google_calendar":
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID ?? ""}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.events")}&redirect_uri=${encodeURIComponent(cb)}&state=${state}&access_type=offline&prompt=consent`;
    case "zoom":
      return `https://zoom.us/oauth/authorize?response_type=code&client_id=${process.env.ZOOM_CLIENT_ID ?? ""}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`;
    case "quickbooks":
      return `https://appcenter.intuit.com/connect/oauth2?client_id=${process.env.QUICKBOOKS_CLIENT_ID ?? ""}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(cb)}&state=${state}`;
    case "xero":
      return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${process.env.XERO_CLIENT_ID ?? ""}&scope=accounting.transactions&redirect_uri=${encodeURIComponent(cb)}&state=${state}`;
    default:
      return "";
  }
}

export default router;
