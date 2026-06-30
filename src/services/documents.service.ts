import { prisma } from "../config/database.js";
import { ApiError } from "../utils/api-error.js";
import { uploadFile, getDownloadUrl, deleteFile, generateStorageKey } from "../config/storage.js";

export async function upload(file: Express.Multer.File, chamaId: string, userId: string) {
  const storageKey = generateStorageKey(chamaId || "general", file.originalname);
  await uploadFile(file.buffer, storageKey, file.mimetype);

  const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
  const type = ext.match(/^(pdf|doc|docx)$/) ? "doc" :
    ext.match(/^(png|jpg|jpeg|gif|webp)$/) ? "image" :
    ext.match(/^(xls|xlsx|csv)$/) ? "sheet" : "pdf";

  const document = await prisma.document.create({
    data: {
      chamaId: chamaId || null,
      uploadedById: userId,
      name: file.originalname,
      type: type as any,
      sizeKb: Math.ceil(file.size / 1024),
      storageKey,
    },
  });

  return document;
}

export async function getDownload(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw ApiError.notFound("Document", documentId);

  return getDownloadUrl(doc.storageKey);
}

export async function list(query: {
  chamaId?: string;
  search?: string;
  page: number;
  pageSize: number;
}) {
  const where: any = {};
  if (query.chamaId) where.chamaId = query.chamaId;
  if (query.search) {
    where.name = { contains: query.search, mode: "insensitive" };
  }

  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { uploadedAt: "desc" },
    }),
    prisma.document.count({ where }),
  ]);

  return {
    items: items.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      sizeKb: d.sizeKb,
      uploadedBy: d.uploadedById,
      uploadedByName: d.uploadedBy.fullName,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function remove(documentId: string, userId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw ApiError.notFound("Document", documentId);

  await deleteFile(doc.storageKey);
  await prisma.document.delete({ where: { id: documentId } });
  return { success: true };
}
