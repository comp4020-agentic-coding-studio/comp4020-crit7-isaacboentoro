import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type Enrolment, enrolments, type Unit, units } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// Real ANU study periods run 18cp as a normal full-time load; going over
// needs a permission this prototype doesn't model, so it's the hard cap.
const CREDIT_POINT_CAP = 18;

// The catalog is fixed reference data, not something an enrolment app lets
// you author — seeded once, at boot, same code path locally and deployed.
function seedUnits(): void {
  const existing = db.select({ id: units.id }).from(units).limit(1).all();
  if (existing.length > 0) return;
  const seed: Omit<Unit, "id">[] = [
    { code: "COMP1100", title: "Introduction to Programming and Algorithms", period: "Semester 1", creditPoints: 6, capacity: 4 },
    { code: "COMP2100", title: "Software Design Methodologies", period: "Semester 1", creditPoints: 6, capacity: 3 },
    { code: "COMP4020", title: "Agentic Coding Studio", period: "Semester 2", creditPoints: 6, capacity: 2 },
    { code: "COMP4610", title: "Principles of Programming Languages", period: "Semester 2", creditPoints: 6, capacity: 3 },
    { code: "MATH1115", title: "Mathematical Foundations for Actuarial Studies", period: "Semester 1", creditPoints: 6, capacity: 5 },
    { code: "COMP3600", title: "Algorithms", period: "Semester 2", creditPoints: 6, capacity: 3 },
    { code: "COMP8420", title: "Advanced Network Security", period: "Semester 2", creditPoints: 12, capacity: 1 },
    { code: "STAT2001", title: "Statistical Techniques for Data Analysis", period: "Semester 1", creditPoints: 6, capacity: 4 },
  ];
  for (const unit of seed) db.insert(units).values(unit).run();
}
seedUnits();

export type { Unit, Enrolment };
export { CREDIT_POINT_CAP };

export type UnitWithAvailability = Unit & { enrolledCount: number; full: boolean };
export type EnrolmentWithUnit = Enrolment & { unit: Unit };

export function listUnits(): UnitWithAvailability[] {
  return db
    .select({
      id: units.id,
      code: units.code,
      title: units.title,
      period: units.period,
      creditPoints: units.creditPoints,
      capacity: units.capacity,
      enrolledCount: sql<number>`(select count(*) from enrolments where enrolments.unit_id = units.id)`,
    })
    .from(units)
    .orderBy(units.code)
    .all()
    .map((unit) => ({ ...unit, full: unit.enrolledCount >= unit.capacity }));
}

export function listEnrolments(): EnrolmentWithUnit[] {
  return db
    .select({ enrolment: enrolments, unit: units })
    .from(enrolments)
    .innerJoin(units, eq(enrolments.unitId, units.id))
    .orderBy(enrolments.id)
    .all()
    .map(({ enrolment, unit }) => ({ ...enrolment, unit }));
}

export function totalCreditPoints(): number {
  return listEnrolments().reduce((sum, e) => sum + e.unit.creditPoints, 0);
}

export type EnrolResult =
  | { ok: true; enrolment: EnrolmentWithUnit }
  | { ok: false; reason: "not-found" | "full" | "over-cap" };

export function enrol(unitId: number): EnrolResult {
  const unit = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!unit) return { ok: false, reason: "not-found" };

  const enrolledCount = db
    .select({ count: sql<number>`count(*)` })
    .from(enrolments)
    .where(eq(enrolments.unitId, unitId))
    .get()!.count;
  if (enrolledCount >= unit.capacity) return { ok: false, reason: "full" };

  if (totalCreditPoints() + unit.creditPoints > CREDIT_POINT_CAP) {
    return { ok: false, reason: "over-cap" };
  }

  const enrolment = db.insert(enrolments).values({ unitId }).returning().get();
  return { ok: true, enrolment: { ...enrolment, unit } };
}

export function dropEnrolment(id: number): boolean {
  const result = db.delete(enrolments).where(eq(enrolments.id, id)).run();
  return result.changes > 0;
}
