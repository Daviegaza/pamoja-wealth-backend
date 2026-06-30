export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function getPaginationParams(query: {
  page?: string | number;
  pageSize?: string | number;
}): PaginationParams {
  const page = Math.max(1, parseInt(String(query.page || "1"), 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(String(query.pageSize || "20"), 10) || 20)
  );
  return { page, pageSize };
}

export function getPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
