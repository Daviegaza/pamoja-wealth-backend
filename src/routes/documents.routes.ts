import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth.js";
import { uploadLimiter } from "../middleware/rate-limit.js";
import * as documents from "../controllers/documents.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "gif", "webp"];
    const ext = file.originalname.split(".").pop()?.toLowerCase();
    cb(null, ext ? allowed.includes(ext) : false);
  },
});

const router = Router();

router.get("/", authenticate, documents.list);
router.post("/upload", authenticate, uploadLimiter, upload.single("file"), documents.upload);
router.get("/:id/download", authenticate, documents.download);
router.delete("/:id", authenticate, documents.remove);

export default router;
