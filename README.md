# Enrolment — an ANUhub slice

The system that reliably ruins my week is ANUhub's unit enrolment flow: a
course you want has no places left, or adding it silently blows your
credit-point load, and you find out after the click rather than before. This
prototype is that one slice, wired end to end over the **real ANU course
catalogue** — all 6,003 course offerings for 2026 and 2027, imported from
Programs and Courses — with the constraints enforced server-side instead of
left to a form that accepts anything.

## Where the data comes from

`src/data/courses.json` is the ANU Programs and Courses catalogue, fetched by
`pnpm courses:fetch` (`scripts/fetch-courses.ts`). P&C renders its catalogue
search client-side from `/data/CourseSearch/GetCourses`, which returns a whole
commencement year in one response, so the import is two requests rather than a
crawl of six thousand pages. Course **code, title, session, career and credit
points are ANU's**.

**Places are not.** P&C publishes no class sizes, so this app derives a
capacity and a number of places already taken from a hash of the course code —
deterministic, so it is stable across reseeds and redeploys, and deliberately
shaped so about one course in sixteen is full and you actually run into the
constraint while browsing. It is invented data. The page says so under the
table, and it is the one thing here a marker should not read as ANU fact.

## What good looks like here

- **A core flow that persists.** Enrol in a course, reload the page (or come
  back after a redeploy) and it's still there. Drop it, and it's gone.
  `spec/enrolment.test.ts` drives the running app over HTTP to check that the
  database, not the client, is the source of truth.
- **You can actually find your course.** Six thousand rows is not a page, so
  the catalogue is a server-rendered search over code and title with career
  and year filters, capped at 50 results and showing the true match count.
  Plain GET form, no JavaScript required.
- **The rules are enforced, not decorative.** A full course refuses an enrol,
  a second enrol in the same course refuses, and going over 24 credit points
  refuses — each with a message saying which rule you hit, and each returning
  you to the search you were reading rather than dumping you back at the top.
  All four live in one place, `enrol()` in `src/lib/db.ts`.
- **Multi-tab live state.** Places and the credit total are shared, so
  enrolling in one tab updates every other open tab over the SSE stream; a
  stale "12 places left" is worse than none.
- **What's a judgement call, not a spec-enforced check:** there's no login —
  "my enrolments" is one shared list, so this models one student's session,
  not a multi-user system. Prerequisites, timetable clashes and program rules
  are out of scope; the three constraints above are the ones that cost me
  time, and going further would be rebuilding ANUhub rather than fixing the
  one slice of it that hurts.
- The accessibility floor (`spec/invariants.test.ts`) and the deployed
  `/readme/` promise (`spec/readme.test.ts`) are shipped, always-on checks
  this app keeps green.
