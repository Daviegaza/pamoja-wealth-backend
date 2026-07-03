/**
 * Video call rooms via Daily.co REST API.
 *
 * Env:
 *   DAILY_API_KEY        - from dashboard
 *   DAILY_DOMAIN         - <your-subdomain>.daily.co
 *
 * Falls back to stub responses when DAILY_API_KEY is unset (dev mode).
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { success } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { prisma } from "../config/database.js";

const router = Router();

const createSchema = z.object({ chamaId: z.string().uuid() });

router.post("/video/rooms", authenticate, validate(createSchema), async (req, res) => {
  const { chamaId } = req.body;
  const isMember = await prisma.membership.findFirst({
    where: { userId: req.user!.userId, chamaId, status: "active" },
    select: { id: true },
  });
  if (!isMember) throw ApiError.forbidden("Not a chama member");

  const key = process.env.DAILY_API_KEY;
  const domain = process.env.DAILY_DOMAIN;
  const roomName = `chama-${chamaId.slice(0, 8)}-${Date.now().toString(36)}`;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  if (!key || !domain) {
    return success(res, {
      roomName,
      url: `https://example.daily.co/${roomName}`,
      token: "dev-token",
      expiresAt,
      provider: "daily",
    });
  }

  const roomRes = await fetch("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: roomName,
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + 30 * 60,
        enable_chat: true,
        enable_screenshare: true,
      },
    }),
  });
  if (!roomRes.ok) throw ApiError.internal("Failed to create room");
  const room = await roomRes.json() as { name: string; url: string };

  const tokenRes = await fetch("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { room_name: room.name, user_id: req.user!.userId, exp: Math.floor(Date.now() / 1000) + 30 * 60 } }),
  });
  const token = await tokenRes.json() as { token: string };

  success(res, {
    roomName: room.name,
    url: room.url,
    token: token.token,
    expiresAt,
    provider: "daily",
  });
});

router.post("/video/rooms/:name/join", authenticate, async (req, res) => {
  const key = process.env.DAILY_API_KEY;
  const domain = process.env.DAILY_DOMAIN ?? "example.daily.co";
  const roomName = req.params.name;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  if (!key) {
    return success(res, { roomName, url: `https://${domain}/${roomName}`, token: "dev-token", expiresAt, provider: "daily" });
  }
  const tokenRes = await fetch("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { room_name: roomName, user_id: req.user!.userId, exp: Math.floor(Date.now() / 1000) + 30 * 60 } }),
  });
  const token = await tokenRes.json() as { token: string };
  success(res, { roomName, url: `https://${domain}/${roomName}`, token: token.token, expiresAt, provider: "daily" });
});

export default router;
