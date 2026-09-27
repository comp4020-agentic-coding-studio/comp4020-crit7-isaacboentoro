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
- **The credit cap is per session, which is the point.** 24 credit points is
  a standard full-time load *in a session*, so four courses in First Semester
  and four more in Second is a normal year, not an overload. Enrolments are
  grouped by session, each with its own `n / 24 cp`, and a course offered in
  several sessions makes you pick which one you're enrolling in.
- **The rules are enforced, not decorative.** Six of them, all in one place —
  `enrol()` in `src/lib/db.ts`: unknown course, a course with no published
  session (in P&C that means it isn't offered), a session the course doesn't
  run in, a second enrol in the same course, no places left, and over that
  session's cap. Each says which rule you hit and returns you to the search
  you were reading rather than dumping you at the top.
- **Multi-tab live state.** Places and the credit total are shared, so
  enrolling in one tab updates every other open tab over the SSE stream; a
  stale "12 places left" is worse than none.
- **It looks like ANU, without pretending to be ANU.** The palette and type
  are taken from ANU's own published stylesheet — Public Sans, ANU gold
  `#be830e`, black and the greys — rather than guessed. Gold is used for
  accents, rules and button fills only, never small text on white, where it
  lands around 4.0:1 and misses the 4.5:1 contrast floor. There is no ANU
  crest, logo or wordmark anywhere: this borrows the design language, and the
  page says in plain words that it's a student prototype.
- **What's a judgement call, not a spec-enforced check:** there's no login —
  "my enrolments" is one shared list, so this models one student's session,
  not a multi-user system. Prerequisites, timetable clashes and program rules
  are out of scope; the three constraints above are the ones that cost me
  time, and going further would be rebuilding ANUhub rather than fixing the
  one slice of it that hurts.
- The accessibility floor (`spec/invariants.test.ts`) and the deployed
  `/readme/` promise (`spec/readme.test.ts`) are shipped, always-on checks
  this app keeps green.
