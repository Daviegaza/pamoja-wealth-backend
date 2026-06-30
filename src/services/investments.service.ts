import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";

export async function create(data: {
  chamaId: string;
  name: string;
  type: string;
  amountInvested: number;
  riskLevel: string;
  startDate: string;
  maturityDate?: string;
}) {
  const investment = await prisma.investment.create({
    data: {
      chamaId: data.chamaId,
      name: data.name,
      type: data.type as any,
      amountInvested: data.amountInvested,
      currentValue: data.amountInvested, // Initial value = investment
      riskLevel: data.riskLevel as any,
      startDate: new Date(data.startDate),
      maturityDate: data.maturityDate ? new Date(data.maturityDate) : null,
    },
  });
  return investment;
}

export async function update(investmentId: string, data: {
  currentValue?: number;
  roi?: number;
  status?: string;
}) {
  const inv = await prisma.investment.findUnique({ where: { id: investmentId } });
  if (!inv) throw ApiError.notFound("Investment", investmentId);

  return prisma.investment.update({
    where: { id: investmentId },
    data: {
      ...(data.currentValue !== undefined && { currentValue: data.currentValue }),
      ...(data.roi !== undefined && { roi: data.roi }),
      ...(data.status !== undefined && { status: data.status as any }),
    },
  });
}

export async function getById(investmentId: string) {
  const inv = await prisma.investment.findUnique({ where: { id: investmentId } });
  if (!inv) throw ApiError.notFound("Investment", investmentId);
  return inv;
}

export async function list(query: {
  chamaId?: string;
  type?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = {};
  if (query.chamaId) where.chamaId = query.chamaId;
  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;

  const [items, total] = await Promise.all([
    prisma.investment.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.investment.count({ where }),
  ]);

  return {
    items: items.map((inv) => ({
      ...inv,
      amountInvested: Number(inv.amountInvested),
      currentValue: Number(inv.currentValue),
      roi: Number(inv.roi),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
