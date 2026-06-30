import { Response } from "express";
import { ApiResponse, PaginationMeta } from "../types/index.js";

export function success<T>(res: Response, data: T, meta?: PaginationMeta, statusCode = 200) {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

export function paginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number
) {
  return success(res, items, {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}
