#!/bin/sh
set -e

echo "==> Running Prisma migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "==> Migrations complete. Starting API server..."
exec node dist/main.js
