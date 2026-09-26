import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import catalogue from "../data/courses.json";
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
export const CREDIT_POINT_CAP = 18;

// How many catalogue rows a search shows at once. The catalogue is ~6000
// courses; a student is looking for one, so the page asks them to narrow
// rather than rendering the lot.
export const PAGE_SIZE = 50;

export const YEARS: number[] = [...new Set(catalogue.map((c) => c.year))].sort();

// Programs and Courses publishes no class sizes, so capacity — and how much
// of it other students have already taken — is the prototype's own, derived
// from the course code so it is stable across reseeds and redeploys rather
// than random. It is invented data, labelled as such in the UI and README:
// everything else about a course comes from P&C.
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function derivePlaces(code: string, year: number): { capacity: number; placesTaken: number } {
  const h = hash(`${code}:${year}`);
  const capacity = 15 + (h % 386);
  // roughly one course in sixteen is already full, so "no places left" is
  // something you actually run into while browsing
  const fill = (h >>> 9) % 100;
  const placesTaken = fill < 6 ? capacity : Math.floor((capacity * fill) / 100);
  return { capacity, placesTaken };
}

// The catalogue is reference data an enrolment app reads, never authors, so
// it is loaded once into an empty database — one transaction, because 6000
// inserts one statement at a time is thousands of fsyncs.
function seedCatalogue(): void {
  if (db.select({ id: units.id }).from(units).limit(1).all().length > 0) return;
  const insert = client.prepare(
    "insert into units (code, title, period, career, year, credit_points, capacity, places_taken) values (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  client.transaction(() => {
    for (const course of catalogue) {
      const { capacity, placesTaken } = derivePlaces(course.code, course.year);
      insert.run(
        course.code,
        course.title,
        course.period,
        course.career,
        course.year,
        course.creditPoints,
        capacity,
        placesTaken,
      );
    }
  })();
}
seedCatalogue();

export type { Unit, Enrolment };

export type UnitWithAvailability = Unit & { enrolledCount: number; full: boolean };
export type EnrolmentWithUnit = Enrolment & { unit: Unit };

const enrolledCount = sql<number>`(${units.placesTaken} + (select count(*) from enrolments where enrolments.unit_id = units.id))`;

function withAvailability(unit: Unit & { enrolledCount: number }): UnitWithAvailability {
  return { ...unit, full: unit.enrolledCount >= unit.capacity };
}

export type CourseSearch = { q?: string; career?: string; year?: number };

export type SearchResults = {
  units: UnitWithAvailability[];
  total: number;
  truncated: boolean;
};

// Every word of the query has to appear somewhere in the code or the title,
// in any order. Matching the query as one contiguous string instead would
// mean "COMP 1100" missed COMP1100, "human centred" missed "Human-Centred",
// and "learning machine" missed "Machine Learning" — the searches a student
// actually types. `like` is case-insensitive for ASCII in SQLite.
const MAX_TERMS = 6;

function searchFilter({ q, career, year }: CourseSearch) {
  const clauses = [];
  const terms = (q ?? "")
    .split(/\s+/)
    .map((term) => term.replaceAll("%", "").replaceAll("_", ""))
    .filter(Boolean)
    .slice(0, MAX_TERMS);
  for (const term of terms) {
    const pattern = `%${term}%`;
    clauses.push(or(like(units.code, pattern), like(units.title, pattern)));
  }
  if (career) clauses.push(eq(units.career, career));
  if (year) clauses.push(eq(units.year, year));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export function searchUnits(search: CourseSearch): SearchResults {
  const where = searchFilter(search);
  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(units)
    .where(where)
    .get()!.count;

  const rows = db
    .select({
      id: units.id,
      code: units.code,
      title: units.title,
      period: units.period,
      career: units.career,
      year: units.year,
      creditPoints: units.creditPoints,
      capacity: units.capacity,
      placesTaken: units.placesTaken,
      enrolledCount,
    })
    .from(units)
    .where(where)
    .orderBy(units.code, units.year)
    .limit(PAGE_SIZE)
    .all();

  return {
    units: rows.map(withAvailability),
    total,
    truncated: total > rows.length,
  };
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
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${units.creditPoints}), 0)` })
      .from(enrolments)
      .innerJoin(units, eq(enrolments.unitId, units.id))
      .get()?.total ?? 0
  );
}

export type EnrolResult =
  | { ok: true; enrolment: EnrolmentWithUnit }
  | { ok: false; reason: "not-found" | "duplicate" | "full" | "over-cap" };

export function enrol(unitId: number): EnrolResult {
  const unit = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!unit) return { ok: false, reason: "not-found" };

  const already = db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(eq(enrolments.unitId, unitId))
    .get();
  if (already) return { ok: false, reason: "duplicate" };

  // the duplicate check above means this student isn't already one of them
  if (unit.placesTaken >= unit.capacity) return { ok: false, reason: "full" };

  if (totalCreditPoints() + unit.creditPoints > CREDIT_POINT_CAP) {
    return { ok: false, reason: "over-cap" };
  }

  const enrolment = db.insert(enrolments).values({ unitId }).returning().get();
  return { ok: true, enrolment: { ...enrolment, unit } };
}

export function dropEnrolment(id: number): boolean {
  return db.delete(enrolments).where(eq(enrolments.id, id)).run().changes > 0;
}
