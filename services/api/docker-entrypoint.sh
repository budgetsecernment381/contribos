#!/bin/sh
set -e

echo "Running Prisma db push to sync schema..."
npx prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || {
  echo "WARNING: prisma db push failed — database may not be ready yet, starting server anyway"
}

echo "Starting API server..."
exec node dist/server.js
