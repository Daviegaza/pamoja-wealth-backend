import { Router, type Response } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requireChamaMember, requireChamaRole, requireUuidParam } from "../middleware/chama-access.js";
import { asyncHandler, requestContext } from "../utils/http.js";
import { success, paginated } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { CHAIR_ROLES, MONEY_ROLES, SECRETARY_ROLES, OFFICER_ROLES, isOfficer, type Role } from "../types/index.js";
import { createChamaSchema, updateChamaSchema, updateMemberRoleSchema, createInviteCodeSchema, joinChamaSchema } from "../validators/chama.schema.js";
import { createScheduleSchema, updateScheduleSchema, recordContributionSchema, reasonSchema, listContributionsQuery } from "../validators/contribution.schema.js";
import { recordLoanSchema, recordRepaymentSchema, loanStatusSchema } from "../validators/loan.schema.js";
import { createMeetingSchema, updateMeetingSchema, minutesSchema, rsvpSchema } from "../validators/meeting.schema.js";
import { createGoalSchema, updateGoalSchema } from "../validators/goal.schema.js";
import { checkoutSchema, verifySchema } from "../validators/billing.schema.js";
import { dateOnly, exportFormat, paginationQuery } from "../validators/common.js";
import * as chamas from "../services/chamas.service.js";
import * as contributions from "../services/contributions.service.js";
import * as loans from "../services/loans.service.js";
import * as meetings from "../services/meetings.service.js";
import * as goals from "../services/goals.service.js";
import * as statements from "../services/statements.service.js";
import * as audit from "../services/audit.service.js";
import * as billing from "../services/billing.service.js";

/**
 * Chama API. Every route below `/:chamaId` passes through
 * `requireChamaMember` (active membership of THAT chama, else 404) and, where
 * needed, `requireChamaRole` (role in THAT chama, else 403). Child records are
 * always fetched with `{ id, chamaId }`, so ids from other chamas 404.
 */
const router = Router();
router.use(authenticate);

// ── Not chama-scoped ──────────────────────────────────────────────────
router.get("/", asyncHandler(async (req, res) => {
  success(res, await chamas.listMine(req.user!.userId));
}));

router.post("/", validate(createChamaSchema), asyncHandler(async (req, res) => {
  success(res, await chamas.create(requestContext(req), req.body), undefined, 201);
}));

router.post("/join", validate(joinChamaSchema), asyncHandler(async (req, res) => {
  success(res, await chamas.joinByCode(requestContext(req), req.body.code));
}));

// ── Chama-scoped ──────────────────────────────────────────────────────
const scoped = Router({ mergeParams: true });
router.use("/:chamaId", requireChamaMember, scoped);

type ScopedReq = { user?: { userId: string }; membership?: { role: string } };
const role = (req: ScopedReq) => req.membership!.role;
const viewer = (req: ScopedReq) => ({ userId: req.user!.userId, role: req.membership!.role });
const chair = requireChamaRole(CHAIR_ROLES);
const money = requireChamaRole(MONEY_ROLES);
const secretary = requireChamaRole(SECRETARY_ROLES);

scoped.get("/", asyncHandler(async (req, res) => {
  success(res, await chamas.getOne(req.params.chamaId, role(req)));
}));
scoped.patch("/", chair, validate(updateChamaSchema), asyncHandler(async (req, res) => {
  success(res, await chamas.update(requestContext(req), req.params.chamaId, role(req), req.body));
}));
scoped.delete("/", chair, asyncHandler(async (req, res) => {
  success(res, await chamas.archive(requestContext(req), req.params.chamaId));
}));

// Members & invitations
scoped.get("/members", asyncHandler(async (req, res) => {
  success(res, await chamas.listMembers(req.params.chamaId, role(req)));
}));
scoped.patch("/members/:userId", chair, requireUuidParam("userId"), validate(updateMemberRoleSchema), asyncHandler(async (req, res) => {
  success(res, await chamas.updateMemberRole(requestContext(req), req.params.chamaId, req.params.userId, req.body.role as Role));
}));
scoped.delete("/members/:userId", chair, requireUuidParam("userId"), asyncHandler(async (req, res) => {
  success(res, await chamas.removeMember(requestContext(req), req.params.chamaId, req.params.userId));
}));
scoped.get("/invite-codes", secretary, asyncHandler(async (req, res) => {
  success(res, await chamas.listInviteCodes(req.params.chamaId));
}));
scoped.post("/invite-codes", secretary, validate(createInviteCodeSchema), asyncHandler(async (req, res) => {
  success(res, await chamas.createInviteCode(requestContext(req), req.params.chamaId, req.body.expiresInDays), undefined, 201);
}));

// Contribution schedules
scoped.get("/contribution-schedules", asyncHandler(async (req, res) => {
  success(res, await contributions.listSchedules(req.params.chamaId));
}));
scoped.post("/contribution-schedules", money, validate(createScheduleSchema), asyncHandler(async (req, res) => {
  success(res, await contributions.createSchedule(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.patch("/contribution-schedules/:scheduleId", money, requireUuidParam("scheduleId"), validate(updateScheduleSchema), asyncHandler(async (req, res) => {
  success(res, await contributions.updateSchedule(requestContext(req), req.params.chamaId, req.params.scheduleId, req.body));
}));

// Contribution records
scoped.get("/contributions/summary", asyncHandler(async (req, res) => {
  success(res, await contributions.summary(req.params.chamaId, viewer(req)));
}));
scoped.get("/contributions", validate(listContributionsQuery, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as contributions.ListQuery;
  const { items, meta } = await contributions.list(req.params.chamaId, viewer(req), q);
  paginated(res, items, meta.total, meta.page, meta.pageSize);
}));
scoped.post("/contributions", money, validate(recordContributionSchema), asyncHandler(async (req, res) => {
  success(res, await contributions.record(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.post("/contributions/:id/confirm", requireUuidParam("id"), asyncHandler(async (req, res) => {
  success(res, await contributions.confirm(requestContext(req), req.params.chamaId, req.params.id));
}));
scoped.post("/contributions/:id/dispute", requireUuidParam("id"), validate(reasonSchema), asyncHandler(async (req, res) => {
  success(res, await contributions.dispute(requestContext(req), req.params.chamaId, req.params.id, req.body.reason));
}));
scoped.post("/contributions/:id/void", money, requireUuidParam("id"), validate(reasonSchema), asyncHandler(async (req, res) => {
  success(res, await contributions.voidRecord(requestContext(req), req.params.chamaId, req.params.id, req.body.reason));
}));

// Goals
scoped.get("/goals", asyncHandler(async (req, res) => {
  success(res, await goals.list(req.params.chamaId));
}));
scoped.post("/goals", money, validate(createGoalSchema), asyncHandler(async (req, res) => {
  success(res, await goals.create(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.patch("/goals/:goalId", money, requireUuidParam("goalId"), validate(updateGoalSchema), asyncHandler(async (req, res) => {
  success(res, await goals.update(requestContext(req), req.params.chamaId, req.params.goalId, req.body));
}));
scoped.delete("/goals/:goalId", money, requireUuidParam("goalId"), asyncHandler(async (req, res) => {
  success(res, await goals.remove(requestContext(req), req.params.chamaId, req.params.goalId));
}));

// Loan register
scoped.get("/loans", asyncHandler(async (req, res) => {
  success(res, await loans.list(req.params.chamaId, viewer(req)));
}));
scoped.post("/loans", money, validate(recordLoanSchema), asyncHandler(async (req, res) => {
  success(res, await loans.record(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.get("/loans/:loanId", requireUuidParam("loanId"), asyncHandler(async (req, res) => {
  success(res, await loans.getOne(req.params.chamaId, req.params.loanId, viewer(req)));
}));
scoped.post("/loans/:loanId/repayments", money, requireUuidParam("loanId"), validate(recordRepaymentSchema), asyncHandler(async (req, res) => {
  success(res, await loans.recordRepayment(requestContext(req), req.params.chamaId, req.params.loanId, req.body), undefined, 201);
}));
scoped.patch("/loans/:loanId/status", chair, requireUuidParam("loanId"), validate(loanStatusSchema), asyncHandler(async (req, res) => {
  success(res, await loans.setStatus(requestContext(req), req.params.chamaId, req.params.loanId, req.body.status));
}));

// Meetings
scoped.get("/meetings", asyncHandler(async (req, res) => {
  success(res, await meetings.list(req.params.chamaId, req.user!.userId));
}));
scoped.post("/meetings", secretary, validate(createMeetingSchema), asyncHandler(async (req, res) => {
  success(res, await meetings.create(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.get("/meetings/:meetingId", requireUuidParam("meetingId"), asyncHandler(async (req, res) => {
  success(res, await meetings.getOne(req.params.chamaId, req.params.meetingId, req.user!.userId));
}));
scoped.patch("/meetings/:meetingId", secretary, requireUuidParam("meetingId"), validate(updateMeetingSchema), asyncHandler(async (req, res) => {
  success(res, await meetings.update(requestContext(req), req.params.chamaId, req.params.meetingId, req.body));
}));
scoped.put("/meetings/:meetingId/minutes", secretary, requireUuidParam("meetingId"), validate(minutesSchema), asyncHandler(async (req, res) => {
  success(res, await meetings.saveMinutes(requestContext(req), req.params.chamaId, req.params.meetingId, req.body.minutes));
}));
scoped.post("/meetings/:meetingId/rsvp", requireUuidParam("meetingId"), validate(rsvpSchema), asyncHandler(async (req, res) => {
  success(res, await meetings.rsvp(requestContext(req), req.params.chamaId, req.params.meetingId, req.body.status));
}));

// Statements (CSV/PDF/JSON, generated from recorded data only)
const statementQuery = z.object({ format: exportFormat, from: dateOnly.optional(), to: dateOnly.optional() });
type StatementQuery = z.infer<typeof statementQuery>;

async function sendStatement(res: Response, st: statements.Statement, format: StatementQuery["format"], baseName: string) {
  const safe = baseName.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "statement";
  res.setHeader("Cache-Control", "no-store");
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.csv"`);
    res.send(statements.toCsv(st));
    return;
  }
  if (format === "pdf") {
    const pdf = await statements.toPdf(st);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.pdf"`);
    res.send(pdf);
    return;
  }
  success(res, st);
}

scoped.get("/statements/chama", validate(statementQuery, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as StatementQuery;
  const st = await statements.build(req.params.chamaId, null, q);
  await sendStatement(res, st, q.format, `${st.chama.name}-statement`);
}));
scoped.get("/statements/members/:userId", requireUuidParam("userId"), validate(statementQuery, "query"), asyncHandler(async (req, res) => {
  // Members may only pull their own statement; officers may pull anyone's.
  if (req.params.userId !== req.user!.userId && !isOfficer(role(req))) {
    throw ApiError.forbidden("You can only download your own statement");
  }
  const q = req.query as unknown as StatementQuery;
  const st = await statements.build(req.params.chamaId, req.params.userId, q);
  await sendStatement(res, st, q.format, `${st.chama.name}-${st.member?.fullName ?? "member"}-statement`);
}));

// Audit log (every member can read their chama's change history)
scoped.get("/audit", validate(paginationQuery, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; pageSize: number };
  const { items, meta } = await audit.listForChama(req.params.chamaId, q.page, q.pageSize);
  paginated(res, items, meta.total, meta.page, meta.pageSize);
}));

// SaaS subscription (Pamoja's only revenue)
scoped.get("/subscription", asyncHandler(async (req, res) => {
  success(res, await billing.getSubscriptionView(req.params.chamaId));
}));
scoped.post("/subscription/checkout", money, validate(checkoutSchema), asyncHandler(async (req, res) => {
  success(res, await billing.createCheckout(requestContext(req), req.params.chamaId, req.body), undefined, 201);
}));
scoped.post("/subscription/verify", validate(verifySchema), asyncHandler(async (req, res) => {
  const outcome = await billing.verifyAndActivate(req.body.reference, requestContext(req), req.params.chamaId);
  success(res, { ...outcome, subscription: await billing.getSubscriptionView(req.params.chamaId) });
}));
scoped.post("/subscription/cancel", chair, asyncHandler(async (req, res) => {
  success(res, await billing.cancel(requestContext(req), req.params.chamaId));
}));
scoped.get("/invoices", requireChamaRole(OFFICER_ROLES), asyncHandler(async (req, res) => {
  success(res, await billing.listInvoices(req.params.chamaId));
}));

export default router;
