import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, eq, exists, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import catalogue from "../data/courses.json";
import { type Enrolment, enrolments, type Unit, units, unitSessions } from "./schema";

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

// A standard full-time ANU load is 24cp in a session — four 6cp courses.
// Going over needs a permission this prototype doesn't model, so it's the
// hard cap. It applies *within* a session: four courses in First Semester
// and four more in Second Semester is a normal year, not an overload.
export const CREDIT_POINT_CAP = 24;

// The sessions the catalogue uses, in the order P&C's own multi-session
// strings put them ("Summer Session/First Semester/Autumn Session/..." and
// "Quarter 1/First Semester/Quarter 2/...").
export const SESSIONS = [
  "Summer Session",
  "Quarter 1",
  "First Semester",
  "Autumn Session",
  "Quarter 2",
  "Winter Session",
  "Quarter 3",
  "Second Semester",
  "Spring Session",
  "Quarter 4",
] as const;

// Where enrolments made before sessions existed end up. Nothing can be
// enrolled into it — a course P&C gives no session isn't offered — so it
// sits outside every cap.
export const NOT_PUBLISHED = "Not published";

function parseSessions(period: string): string[] {
  const seen = new Set(
    period
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const known = SESSIONS.filter((session) => seen.delete(session));
  // anything P&C starts publishing that isn't in the list above still shows
  return [...known, ...seen];
}

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

// Derived from units.period, which every row already has, so this fills in
// on a database seeded before sessions existed as well as on a fresh one.
// Keeping it separate from seedCatalogue() is the point: that one returns
// early when the catalogue is already there, which on an existing volume
// would leave this table empty and every course reading as "not offered".
function seedUnitSessions(): void {
  if (db.select({ id: unitSessions.id }).from(unitSessions).limit(1).all().length > 0) return;
  const rows = db.select({ id: units.id, period: units.period }).from(units).all();
  const insert = client.prepare("insert into unit_sessions (unit_id, session) values (?, ?)");
  client.transaction(() => {
    for (const row of rows) {
      for (const session of parseSessions(row.period)) insert.run(row.id, session);
    }
  })();
}
seedUnitSessions();

// Enrolments made before sessions existed carry session = "". Give each one
// its course's first session so it still counts against a cap, and park the
// ones whose course publishes none under NOT_PUBLISHED rather than deleting
// somebody's enrolment to tidy up the schema.
function backfillEnrolmentSessions(): void {
  const stale = db
    .select({ id: enrolments.id, unitId: enrolments.unitId })
    .from(enrolments)
    .where(eq(enrolments.session, ""))
    .all();
  for (const row of stale) {
    const first = db
      .select({ session: unitSessions.session })
      .from(unitSessions)
      .where(eq(unitSessions.unitId, row.unitId))
      .orderBy(asc(unitSessions.id))
      .get();
    db.update(enrolments)
      .set({ session: first?.session ?? NOT_PUBLISHED })
      .where(eq(enrolments.id, row.id))
      .run();
  }
}
backfillEnrolmentSessions();

export type { Unit, Enrolment };

export type UnitWithAvailability = Unit & {
  enrolledCount: number;
  full: boolean;
  sessions: string[];
};
export type EnrolmentWithUnit = Enrolment & { unit: Unit };

const enrolledCount = sql<number>`(${units.placesTaken} + (select count(*) from enrolments where enrolments.unit_id = units.id))`;


export type CourseSearch = { q?: string; career?: string; year?: number; session?: string };

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

function searchFilter({ q, career, year, session }: CourseSearch) {
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
  if (session) {
    clauses.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(unitSessions)
          .where(and(eq(unitSessions.unitId, units.id), eq(unitSessions.session, session))),
      ),
    );
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export function sessionsFor(unitId: number): string[] {
  return db
    .select({ session: unitSessions.session })
    .from(unitSessions)
    .where(eq(unitSessions.unitId, unitId))
    .orderBy(asc(unitSessions.id))
    .all()
    .map((row) => row.session);
}

// one query for the whole result page rather than one per row
function sessionsByUnit(unitIds: number[]): Map<number, string[]> {
  const byUnit = new Map<number, string[]>();
  if (unitIds.length === 0) return byUnit;
  const rows = db
    .select({ unitId: unitSessions.unitId, session: unitSessions.session })
    .from(unitSessions)
    .where(sql`${unitSessions.unitId} in ${unitIds}`)
    .orderBy(asc(unitSessions.id))
    .all();
  for (const row of rows) {
    byUnit.set(row.unitId, [...(byUnit.get(row.unitId) ?? []), row.session]);
  }
  return byUnit;
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

  const sessions = sessionsByUnit(rows.map((row) => row.id));

  return {
    units: rows.map((row) => ({
      ...row,
      full: row.enrolledCount >= row.capacity,
      sessions: sessions.get(row.id) ?? [],
    })),
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

// The cap is per session, so the load is a number per session, not one
// total. Sessions with nothing in them are left out.
export function creditPointsBySession(): Map<string, number> {
  const rows = db
    .select({ session: enrolments.session, total: sql<number>`sum(${units.creditPoints})` })
    .from(enrolments)
    .innerJoin(units, eq(enrolments.unitId, units.id))
    .groupBy(enrolments.session)
    .all();
  return new Map(rows.map((row) => [row.session, row.total]));
}

export type EnrolResult =
  | { ok: true; enrolment: EnrolmentWithUnit }
  | {
      ok: false;
      reason: "not-found" | "not-offered" | "bad-session" | "duplicate" | "full" | "over-cap";
    };

export function enrol(unitId: number, session: string): EnrolResult {
  const unit = db.select().from(units).where(eq(units.id, unitId)).get();
  if (!unit) return { ok: false, reason: "not-found" };

  // P&C giving a course no session means it isn't offered that year, so
  // there is nothing to enrol in
  const offered = sessionsFor(unitId);
  if (offered.length === 0) return { ok: false, reason: "not-offered" };
  // the session arrives from a form, so it is checked against the catalogue
  // rather than trusted
  if (!offered.includes(session)) return { ok: false, reason: "bad-session" };

  const already = db
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(eq(enrolments.unitId, unitId))
    .get();
  if (already) return { ok: false, reason: "duplicate" };

  // the duplicate check above means this student isn't already one of them
  if (unit.placesTaken >= unit.capacity) return { ok: false, reason: "full" };

  const load = creditPointsBySession().get(session) ?? 0;
  if (load + unit.creditPoints > CREDIT_POINT_CAP) {
    return { ok: false, reason: "over-cap" };
  }

  const enrolment = db.insert(enrolments).values({ unitId, session }).returning().get();
  return { ok: true, enrolment: { ...enrolment, unit } };
}

export function dropEnrolment(id: number): boolean {
  return db.delete(enrolments).where(eq(enrolments.id, id)).run().changes > 0;
}
