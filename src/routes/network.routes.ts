import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import * as network from "../controllers/network.controller.js";

const router = Router();

router.get("/connections", authenticate, network.getConnections);
router.get("/stats", authenticate, network.getStats);
router.get("/privacy", authenticate, network.getPrivacy);
router.patch("/privacy", authenticate, network.updatePrivacy);

export default router;
