# Rules for this repo

- **Schema changes always go through `pnpm db:generate`.** Edit
  `src/lib/schema.ts`, generate, commit the schema edit and the migration
  file together. Never hand-edit `drizzle/*.sql` and never touch the
  database directly — the deployed volume's state has to survive every
  migration in the trail.
- **`drizzle-kit generate` needs a TTY** when a diff could be read as a
  table rename (dropping one table while adding another, or reshaping a
  table in place) — it prompts interactively and just errors under a
  non-interactive shell. Split an ambiguous schema change into two
  generations: one that's a pure drop, one that's a pure add. Each is
  unambiguous and needs no prompt.
- **Be explicit about which data is ANU's and which is invented.** Course
  code, title, session, career and credit points come from Programs and
  Courses via `pnpm courses:fetch`. Capacity and places-taken are derived by
  this app because P&C publishes no class sizes. Anywhere the two sit next
  to each other — the page, the README, a commit message — say so. Never
  present derived numbers as catalogue fact.
- **Derived data must be deterministic.** Capacity comes from a hash of the
  course code, not a random number, so a reseed or a redeploy doesn't
  silently change what's full — and the spec can assert on a specific course
  without duplicating the derivation.
- **Enrolment rules live in `src/lib/db.ts`, not in routes.** `enrol()` is
  the one place that decides whether an enrolment is allowed (unknown
  course, not offered, wrong session, duplicate, no places, over that
  session's credit cap); API routes call it and turn the result into a
  redirect. Don't duplicate a check in a route or a page.
- **The credit cap is per session, never global.** A student takes 24cp in
  First Semester *and* 24cp in Second. Anything summing credit points across
  every enrolment is a bug.
- **A session off a form is never trusted.** `enrol()` checks the submitted
  session against the sessions the catalogue lists for that course, the same
  way the redirect target is rebuilt rather than echoed.
- **Follow ANU's published styles, don't invent them.** The palette and type
  come from ANU's own stylesheet (Public Sans, `#be830e`, `#767676`,
  `#ebebeb`). Two standing limits: gold is for accents, rules and button
  fills — never small text on white, which fails contrast — and no ANU
  crest, logo or wordmark, because this must not read as an official ANU
  system.
- **Never redirect to a caller-supplied URL.** A rejected enrol returns the
  student to their search, but the target is rebuilt field by field from the
  form (`backTo()` in `src/pages/api/enrolments.ts`), never echoed back from
  a submitted URL — that would be an open redirect.
- **No auth, one shared enrolment list.** Deliberately out of scope — don't
  add accounts or per-user state unless the brief changes; it would be scope
  creep, not the annoying part being modelled.
- **The catalogue is read-only reference data.** The app enrols and drops;
  it never authors courses. Refresh it with `pnpm courses:fetch`, not by
  editing rows.
- **Keep `spec/*.test.ts` green.** `pnpm check` (typecheck + build + vitest)
  before considering anything done. The invariants and README checks are
  shipped and always on; don't weaken or delete them to make a change fit.
- **Prefer rejecting with a reason over a silent no-op.** A form that
  swallows an invalid enrol is worse than the ANUhub behaviour this app is
  replacing — every rejection redirects with an `?error=` the page renders
  as a real message.
