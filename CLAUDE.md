# Rules for this repo

- **Schema changes always go through `pnpm db:generate`.** Edit
  `src/lib/schema.ts`, generate, commit the schema edit and the migration
  file together. Never hand-edit `drizzle/*.sql` and never touch the
  database directly — the deployed volume's state has to survive every
  migration in the trail.
- **`drizzle-kit generate` needs a TTY** when a diff could be read as a
  table rename (e.g. dropping one table while adding others in the same
  edit) — it prompts interactively and just hangs/errors under a
  non-interactive shell. Split an ambiguous schema change into two
  generations: one that's a pure drop, one that's a pure add. Each is
  unambiguous and needs no prompt.
- **Capacity and credit-cap logic lives in `src/lib/db.ts`, not in routes.**
  `enrol()` is the one place that decides whether an enrolment is allowed;
  API routes just call it and turn the result into a redirect. Don't
  duplicate the checks in a route or in a page.
- **No auth, one shared enrolment list.** Deliberately out of scope for this
  slice — don't add a login system or per-user state unless the brief
  changes; it would be scope creep, not the annoying part being modelled.
- **Keep `spec/*.test.ts` green.** `pnpm check` (typecheck + build + vitest)
  before considering anything done. The invariants and README checks are
  shipped and always on; don't weaken or delete them to make a change fit.
- **Prefer rejecting with a reason over a silent no-op.** A form that just
  swallows an invalid enrol (over capacity, over the credit cap) is worse
  than the ANUhub behaviour this app is replacing — every rejection redirects
  with an `?error=` the page renders as a real message.
