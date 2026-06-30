import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { requirePermission } from "../middleware/permissions.js";
import { createVoteSchema, castVoteSchema, voteQuerySchema } from "../validators/vote.schema.js";
import * as votes from "../controllers/votes.controller.js";

const router = Router();

router.get("/", authenticate, validate(voteQuerySchema, "query"), votes.list);
router.post("/", authenticate, requirePermission("manage_votes"), validate(createVoteSchema), votes.create);
router.post("/:id/cast", authenticate, validate(castVoteSchema), votes.castVote);
router.get("/:id", authenticate, votes.getById);
router.post("/:id/close", authenticate, requirePermission("manage_votes"), votes.close);
router.get("/:id/results", authenticate, votes.getResults);

export default router;
