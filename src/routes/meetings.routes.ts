import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requirePermission } from "../middleware/permissions.js";
import { createMeetingSchema, updateMeetingSchema, rsvpSchema, meetingQuerySchema, meetingMinutesSchema } from "../validators/meeting.schema.js";
import * as meetings from "../controllers/meetings.controller.js";

const router = Router();

router.get("/", authenticate, validate(meetingQuerySchema, "query"), meetings.list);
router.post("/", authenticate, requirePermission("create_meetings"), validate(createMeetingSchema), meetings.create);
router.post("/:id/rsvp", authenticate, validate(rsvpSchema), meetings.rsvp);
router.patch("/:id", authenticate, requirePermission("create_meetings"), validate(updateMeetingSchema), meetings.update);
router.get("/:id", authenticate, meetings.getById);
router.post("/:id/minutes", authenticate, requirePermission("create_meetings"), validate(meetingMinutesSchema), meetings.saveMinutes);

export default router;
