import { JwtPayload } from "./index.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express request augmentation requires a namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      correlationId?: string;
      membership?: {
        id: string;
        userId: string;
        chamaId: string;
        role: string;
        status: string;
      };
    }
  }
}

export {};
