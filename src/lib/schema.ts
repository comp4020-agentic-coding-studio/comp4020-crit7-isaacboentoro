import { sql } from "drizzle-orm";
import { index, int, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.

// One row per course offering in the ANU Programs and Courses catalogue.
// code, title, period, career and creditPoints are P&C's (see
// scripts/fetch-courses.ts); capacity and placesTaken are the prototype's
// own, because P&C publishes no class sizes — src/lib/db.ts derives them.
export const units = sqliteTable(
  "units",
  {
    id: int().primaryKey({ autoIncrement: true }),
    code: text().notNull(),
    title: text().notNull(),
    period: text().notNull(),
    career: text().notNull(),
    year: int().notNull(),
    creditPoints: int("credit_points").notNull(),
    capacity: int().notNull(),
    placesTaken: int("places_taken").notNull(),
    // P&C's requisite prose, and the machine-checkable rule parsed out of it
    // when it is unambiguous (see src/lib/requisites.ts). Null rule with
    // non-null text means the course shows its requirement but nothing is
    // enforced — the honest state for "N units of 1000 level MATH".
    requisiteText: text("requisite_text"),
    requisiteRule: text("requisite_rule"),
  },
  (table) => [
    unique("units_code_year").on(table.code, table.year),
    index("units_year").on(table.year),
  ],
);

// P&C publishes a course's sessions as one "/"-joined string; this is that
// string parsed, one row per session a course is actually offered in, so a
// session can be filtered and enrolled against.
export const unitSessions = sqliteTable(
  "unit_sessions",
  {
    id: int().primaryKey({ autoIncrement: true }),
    unitId: int("unit_id")
      .notNull()
      .references(() => units.id),
    session: text().notNull(),
  },
  (table) => [
    unique("unit_sessions_unit_session").on(table.unitId, table.session),
    index("unit_sessions_session").on(table.session),
  ],
);

// No accounts in this prototype: these rows are the one student's enrolments,
// so a unit appears at most once. `session` is which offering of the course
// was enrolled in — the credit cap applies within a session, not across all
// of them.
export const enrolments = sqliteTable("enrolments", {
  id: int().primaryKey({ autoIncrement: true }),
  unitId: int("unit_id")
    .notNull()
    .unique()
    .references(() => units.id),
  // defaulted so the column can be added to a table that already holds
  // enrolments; src/lib/db.ts backfills those rows at boot
  session: text().notNull().default(""),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// What the student has already passed, as course codes — a prerequisite
// names a course, not a particular year's offering of it.
export const completedCourses = sqliteTable("completed_courses", {
  id: int().primaryKey({ autoIncrement: true }),
  code: text().notNull().unique(),
});

// A permission code is what a convener issues to let someone past a rule
// they don't meet. Each is bound to one course, grants one specific
// exception, and burns on use.
export const permissionCodes = sqliteTable("permission_codes", {
  id: int().primaryKey({ autoIncrement: true }),
  code: text().notNull().unique(),
  unitId: int("unit_id")
    .notNull()
    .references(() => units.id),
  grants: text().notNull(), // "full" | "over-cap" | "prereq"
  usedAt: text("used_at"),
});

export type Unit = typeof units.$inferSelect;
export type Enrolment = typeof enrolments.$inferSelect;
export type UnitSession = typeof unitSessions.$inferSelect;
export type CompletedCourse = typeof completedCourses.$inferSelect;
export type PermissionCode = typeof permissionCodes.$inferSelect;
