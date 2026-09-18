#!/bin/sh
set -e

echo "🔄 Waiting for PostgreSQL to be ready..."

# Wait until PostgreSQL accepts connections (max 30 attempts, 2s each)
MAX_RETRIES=30
RETRY_COUNT=0
until npx prisma db execute --stdin < /dev/null 2>/dev/null; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "❌ Could not connect to PostgreSQL after ${MAX_RETRIES} attempts. Exiting."
    exit 1
  fi
  echo "⏳ PostgreSQL not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES)..."
  sleep 2
done

echo "✅ PostgreSQL is ready!"

echo "🗄️  Running database migrations..."
npx prisma migrate deploy

echo "🚀 Starting LoveTap server..."

# Execute the CMD passed to the container
exec "$@"
