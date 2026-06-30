import { JwtPayload } from "./index.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      membership?: {
        id: string;
        userId: string;
        chamaId: string;
        role: string;
      };
    }
  }
}

export {};
