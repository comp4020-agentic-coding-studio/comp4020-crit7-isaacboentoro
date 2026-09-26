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
  },
  (table) => [
    unique("units_code_year").on(table.code, table.year),
    index("units_year").on(table.year),
  ],
);

// No accounts in this prototype: these rows are the one student's enrolments,
// so a unit appears at most once.
export const enrolments = sqliteTable("enrolments", {
  id: int().primaryKey({ autoIncrement: true }),
  unitId: int("unit_id")
    .notNull()
    .unique()
    .references(() => units.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Unit = typeof units.$inferSelect;
export type Enrolment = typeof enrolments.$inferSelect;
