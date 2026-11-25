// Applies pending Drizzle migrations to the database at DATABASE_PATH
// (./data.db locally). Used when the app starts in production.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle"
);

const sqlite = new Database(process.env.DATABASE_PATH ?? "data.db");
sqlite.pragma("foreign_keys = ON");
migrate(drizzle(sqlite), { migrationsFolder });
sqlite.close();
console.log("Migrations applied.");
