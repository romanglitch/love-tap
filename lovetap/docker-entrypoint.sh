#!/bin/sh
set -e

echo "🔄 Waiting for PostgreSQL to be ready..."

# Parse host and port from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_PORT=${DB_PORT:-5432}

echo "📡 Connecting to ${DB_HOST}:${DB_PORT}..."

# Wait until PostgreSQL accepts connections (max 30 attempts, 2s each)
MAX_RETRIES=30
RETRY_COUNT=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; do
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
