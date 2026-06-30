import { Router } from "express";
import { authenticate, optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission } from "../middleware/permissions.js";
import { requireFeature } from "../middleware/plan-gate.js";
import {
  createChamaSchema, updateChamaSchema, joinChamaSchema,
  inviteMemberSchema, chamaQuerySchema, memberQuerySchema,
  discoverChamaQuerySchema, acceptInvitationSchema, decideJoinRequestSchema,
  donationSchema, contributeSchema, donateNowSchema,
} from "../validators/chama.schema.js";
import * as chamas from "../controllers/chamas.controller.js";
import * as contribute from "../controllers/contribute.controller.js";
import rulesRouter from "./chamas/rules.routes.js";

const router = Router();

// Versioned rule documents per chama (RESEARCH_DOSSIER §7.18).
// Mounted before the catch-all /:id GET so paths like /:id/rules/active
// don't get swallowed by params.
router.use("/:id/rules", rulesRouter);

router.get("/discover", authenticate, validate(discoverChamaQuerySchema, "query"), chamas.discover);
router.get("/my-invitations", authenticate, chamas.myInvitations);
router.post("/invitations/accept", authenticate, validate(acceptInvitationSchema), chamas.acceptInvitation);
router.post("/invitations/decline", authenticate, validate(acceptInvitationSchema), chamas.declineInvitation);

router.get("/", authenticate, validate(chamaQuerySchema, "query"), chamas.list);
router.post("/", authenticate, validate(createChamaSchema), chamas.create);
router.get("/:id", authenticate, chamas.getById);
router.patch("/:id", authenticate, requirePermission("manage_settings"), validate(updateChamaSchema), chamas.update);
router.delete("/:id", authenticate, chamas.deleteChama);

router.get("/:id/members", authenticate, validate(memberQuerySchema, "query"), chamas.getMembers);
router.post("/:id/join", authenticate, validate(joinChamaSchema), chamas.join);

router.post("/:id/invite", authenticate, requirePermission("manage_members"), validate(inviteMemberSchema), chamas.invite);
router.get("/:id/invitations", authenticate, requirePermission("manage_members"), chamas.listInvitations);
router.get("/:id/search-users", authenticate, requirePermission("manage_members"), chamas.searchUserForInvite);

router.get("/:id/join-requests", authenticate, requirePermission("manage_members"), chamas.listJoinRequests);
router.post("/:id/join-requests/:requestId/decision", authenticate, requirePermission("manage_members"), validate(decideJoinRequestSchema), chamas.decideJoinRequest);

router.post("/:id/approve-join/:userId", authenticate, requirePermission("manage_members"), chamas.approveJoin);
router.post("/:id/remove-member/:userId", authenticate, requirePermission("manage_members"), chamas.removeMember);

router.post("/:id/donate", authenticate, validate(donationSchema), chamas.donate);
router.get("/:id/donations", authenticate, chamas.listDonations);

// Zero-friction contribute / donate (RESEARCH_DOSSIER §4 — STK Push only).
// Mounted under /chamas because the polymorphic group is still under /chamas
// per CODEMAP. Idempotency-Key header REQUIRED — see middleware comment.
router.post(
  "/:id/contribute",
  authenticate,
  idempotency(),
  validate(contributeSchema),
  contribute.contribute,
);
router.post(
  "/:id/donate-now",
  optionalAuth,
  idempotency(),
  validate(donateNowSchema),
  contribute.donateNow,
);

router.get("/:id/stats", authenticate, chamas.getStats);
// Advanced analytics is plan-gated (Starter+). Basic /stats stays free for all.
router.get(
  "/:id/analytics",
  authenticate,
  requirePermission("view_analytics"),
  requireFeature("advanced_analytics"),
  chamas.getAnalytics,
);

export default router;
