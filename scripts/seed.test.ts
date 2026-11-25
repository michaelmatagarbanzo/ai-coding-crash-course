import Database from "better-sqlite3";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real seed script, exactly as `npm run db:seed` does, against a
// temporary database file, then checks what it seeded. Never touches data.db.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type SeededUser = { name: string; email: string; role: string; avatarUrl: string };

let dir: string;
let users: SeededUser[];
let purchases: { count: number; total: number };
let teamAdmins: string[];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cadence-seed-"));
  const dbPath = path.join(dir, "seed.db");
  execFileSync(path.join(root, "node_modules/.bin/tsx"), ["scripts/seed.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: dbPath },
    stdio: "pipe",
  });

  const db = new Database(dbPath, { readonly: true });
  users = db
    .prepare("SELECT name, email, role, avatar_url AS avatarUrl FROM users ORDER BY id")
    .all() as SeededUser[];
  purchases = db
    .prepare("SELECT COUNT(*) AS count, SUM(amount_paid) AS total FROM purchases")
    .get() as { count: number; total: number };
  teamAdmins = (
    db
      .prepare(
        "SELECT DISTINCT u.name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.role = 'admin' ORDER BY u.name"
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
  db.close();
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NEW_NAMES = [
  "Michael M.", "Rebeca R.", "Johan A.", "Yelko C.", "Audrey A.",
  "Richard B.", "Luis F.", "Roger E.", "Julian A.", "Allan E.",
  "Andrés S.", "Waleska B.", "Guido D.", "Rebeca J.", "Steven V.",
  "Edson P.", "Carlos A.", "Jordan H.", "Jorge G.",
];

const REPLACED_NAMES = [
  "Alex Rivera", "Sarah Chen", "Marcus Johnson", "Bossy McBossface", "Priya Shah",
  "Emma Wilson", "James Park", "Olivia Martinez", "Liam Thompson", "Sophia Davis",
  "Ava Chen", "Lucas Silva", "Mia Kowalski", "Ethan Okafor", "Isabella Rossi",
  "Mateo Garcia", "Chloe Dubois", "Arjun Mehta", "Zara Ahmed",
];

const KEPT_NAMES = [
  "Oliver Brown", "Amara Nwosu", "Daniel Novak", "Hana Tanaka", "Gabriel Santos",
  "Freya Larsen", "Ravi Patel", "Tom Walsh", "Nina Petrova",
];

const namesWithRole = (role: string) =>
  users.filter((u) => u.role === role).map((u) => u.name);

describe("seed", () => {
  it("names the example people after the group, with surname initials", () => {
    const names = users.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining([...NEW_NAMES, ...KEPT_NAMES]));
    for (const old of REPLACED_NAMES) expect(names).not.toContain(old);
  });

  it("gives the admin, instructor and team admin slots to the right people", () => {
    expect(namesWithRole("admin")).toEqual(["Michael M."]);
    expect(namesWithRole("instructor")).toEqual(["Rebeca R.", "Johan A."]);
    expect(teamAdmins).toEqual(["Audrey A.", "Yelko C."]);
  });

  it("derives plain ASCII, unique emails from the names", () => {
    const emails = users.map((u) => u.email);
    for (const email of emails) expect(email).toMatch(/^[a-z0-9.]+@[a-z]+\.dev$/);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).toContain("michael.m@ralph.dev");
    expect(emails).toContain("andres.s@student.dev");
  });

  it("gives every person a distinct avatar", () => {
    const avatars = users.map((u) => u.avatarUrl);
    expect(new Set(avatars).size).toBe(avatars.length);
  });

  it("keeps the same people and sales as before", () => {
    expect(users).toHaveLength(28);
    expect(namesWithRole("student")).toHaveLength(25);
    expect(purchases).toEqual({ count: 24, total: 135477 });
  });
});
