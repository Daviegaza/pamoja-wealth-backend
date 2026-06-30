import { Response, NextFunction } from "express";
import { Request } from "express";
import * as documentService from "../services/documents.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await documentService.list(req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) { next(err); }
}

export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) return next(new Error("No file uploaded"));
    const result = await documentService.upload(
      req.file,
      req.body.chamaId,
      req.user!.userId
    );
    success(res, result, undefined, 201);
  } catch (err) { next(err); }
}

export async function download(req: Request, res: Response, next: NextFunction) {
  try {
    const url = await documentService.getDownload(req.params.id);
    res.redirect(url);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await documentService.remove(req.params.id, req.user!.userId);
    success(res, result);
  } catch (err) { next(err); }
}
