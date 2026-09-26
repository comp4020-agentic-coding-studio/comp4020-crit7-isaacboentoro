# Enrolment — an ANUhub slice

The system that reliably ruins my week is ANUhub's unit enrolment flow: a
unit you want is full, or adding it silently blows your credit-point load
for the session, and you find out after the fact. This prototype is that one
slice, wired end to end: a seeded catalog of units, enrol/drop, persisted in
SQLite, with the two constraints that actually bite enforced server-side
rather than left to a form that just accepts anything.

## What good looks like here

- **A core flow that persists.** Enrol in a unit, reload the page (or come
  back after a redeploy) and it's still there. Drop it, and it's gone. This
  is `spec/enrolment.test.ts`'s job: it drives the running app over HTTP and
  checks the database, not the client, is the source of truth.
- **The catalog is real reference data, not something the app lets you
  invent.** Units are seeded once at boot (`src/lib/db.ts`); the app only
  lets you enrol in or drop from what's seeded, matching how a real
  timetabling system treats its unit catalog as authoritative.
- **Capacity is enforced, not decorative.** A unit at its seeded capacity
  shows "Full" and refuses a further enrol with a real error, not a silent
  no-op — enforced in `src/lib/db.ts#enrol`, checked in the spec.
- **The 18 credit-point session cap is enforced.** Enrolling past it is
  rejected with a message explaining why, same as capacity.
- **Multi-tab live state.** Capacity and the credit total are shared state:
  enrol in one tab and every other open tab's numbers update over the
  existing SSE stream, because a stale "2 places left" is worse than none.
- **What's a judgement call, not a spec-enforced check:** there's no login —
  "my enrolments" is one shared list, same simplicity level as the starter's
  guestbook, because modelling per-student accounts wasn't the point of this
  slice. Prerequisite checking is out of scope too; the two constraints
  above are the ones that actually caused me pain, and going further would
  be building a second ANUhub rather than the one annoying slice of it.
- The accessibility floor (`spec/invariants.test.ts`) and the deployed
  `/readme/` promise (`spec/readme.test.ts`) are shipped, always-on checks
  this app keeps green same as any other week's prototype.
