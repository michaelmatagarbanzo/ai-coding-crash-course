#!/bin/sh
# Production start (Azure App Service). Creates the SQLite database with demo
# data on first start, applies new migrations on later starts, then serves.
set -e

DB="${DATABASE_PATH:-data.db}"
mkdir -p "$(dirname "$DB")"

if [ -f "$DB" ]; then
  npx tsx scripts/migrate.ts
else
  echo "No database at $DB; seeding demo data."
  npx tsx scripts/seed.ts
fi

export NODE_ENV=production
exec npm start
