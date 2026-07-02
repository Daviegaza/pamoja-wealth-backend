import { Response, NextFunction } from "express";
import { Request } from "express";
import * as chamaService from "../services/chamas.service.js";
import { success, paginated } from "../utils/api-response.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.list({ ...(req.query as any), userId: req.user!.userId });
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.create(req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.getById(req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.update(req.params.id, req.body);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function deleteChama(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.deleteChama(req.params.id, req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.getMembers(req.params.id, req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) {
    next(err);
  }
}

export async function join(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.join(req.params.id, req.body, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function invite(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.invite(req.params.id, req.user!.userId, req.body);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function discover(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.discover(req.query as any);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) {
    next(err);
  }
}

export async function searchUserForInvite(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req.query.q as string) || "";
    if (q.length < 2) return success(res, []);
    const result = await chamaService.searchUserForInvite(q);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function listInvitations(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.listInvitations(req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitation(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.acceptInvitation(req.body.token, req.user!.userId);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function declineInvitation(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.declineInvitation(req.body.token, req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function myInvitations(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.listMyInvitations(req.user!.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function listJoinRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.listJoinRequests(req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function decideJoinRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.decideJoinRequest(
      req.params.id,
      req.params.requestId,
      req.user!.userId,
      req.body.decision
    );
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function donate(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.donate(req.params.id, req.body, req.user?.userId);
    success(res, result, undefined, 201);
  } catch (err) {
    next(err);
  }
}

export async function listDonations(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt((req.query.page as string) || "1", 10);
    const pageSize = parseInt((req.query.pageSize as string) || "20", 10);
    const result = await chamaService.listDonations(req.params.id, page, pageSize);
    paginated(res, result.items, result.total, result.page, result.pageSize);
  } catch (err) {
    next(err);
  }
}

export async function approveJoin(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.approveJoin(
      req.params.id,
      req.params.userId,
      req.user!.userId
    );
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.removeMember(req.params.id, req.params.userId);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function updateMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const membership = await chamaService.updateMemberRole(
      req.params.id,
      req.params.userId,
      req.user!.userId,
      req.body.role,
      req.body.customTitle,
    );
    success(res, membership);
  } catch (err) {
    next(err);
  }
}

export async function getStats(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.getStats(req.params.id);
    success(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await chamaService.getAnalytics(
      req.params.id,
      (req.query.period as string) || "monthly",
      req.query.from as string | undefined,
      req.query.to as string | undefined
    );
    success(res, result);
  } catch (err) {
    next(err);
  }
}
