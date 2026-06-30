import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

type ValidationSource = "body" | "query" | "params";

export function validate(schema: ZodSchema, source: ValidationSource = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const data = req[source];
    const result = schema.safeParse(data);
    if (!result.success) {
      return next(result.error);
    }
    req[source] = result.data;
    next();
  };
}
