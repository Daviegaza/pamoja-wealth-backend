#!/bin/sh
set -e

echo "==> Running Prisma migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "==> Starting Pamoja Wealth API..."
exec node dist/index.js
