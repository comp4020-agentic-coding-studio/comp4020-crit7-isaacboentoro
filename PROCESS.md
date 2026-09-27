# Process overview

## What I built

An enrolment slice of ANUhub, over the real ANU course catalogue: all 6,003
course offerings for 2026 and 2027 imported from Programs and Courses,
searchable, with enrol/drop persisted in SQLite and the enrolment rules —
no places left, already enrolled, over the 24 credit-point cap — enforced
server-side.

## How I got here

The brief (C7: build the ANU system you wish existed) asks for one annoying
slice of a real ANU system, wired end to end, not a whole rebuild. I picked
unit enrolment over timetabling/room booking because the two failure modes
that actually cost me time are silent: a unit fills up, or an add pushes me
over my credit-point load, and ANUhub tells you after the click, not before.

I read `spec/README.md` first to see what's already shipped (invariants,
the README promise, the starter's guestbook check) versus what's mine to
write, so I knew not to duplicate the accessibility/route-coverage checks
and to replace, not keep, the guestbook's own test once its plumbing was
gone.

Build order followed the data first: schema
([`6d4be2d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-isaacboentoro/commit/6d4be2d)),
then the rules that make this more than CRUD — capacity and the credit cap
live in one place (`enrol()`), not scattered across routes
([`7319b88`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-isaacboentoro/commit/7319b88)),
then the HTTP surface and the page
([`1e5d44b...7d77f86`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-isaacboentoro/compare/1e5d44b...7d77f86)).

`pnpm db:generate` hung under the agent's non-interactive shell the first
time — drizzle-kit wanted a TTY to ask whether dropping `messages` while
adding `units`/`enrolments` was a rename. Splitting the schema edit into a
pure drop, generated on its own, then a pure add, generated on its own,
avoided the ambiguity entirely rather than working around the prompt. That's
now a rule in `CLAUDE.md` so it doesn't cost time again.

I wrote `spec/enrolment.test.ts` to check the app's own promises, not
mechanics: persistence across a reload, capacity actually blocking a full
unit, the credit cap actually blocking an over-limit enrol. First pass had a
regex bug in the test itself (matching the first catalog row's id regardless
of which unit code I asked for), caught because the capacity assertion
failed for a unit that should have been full — the test lied about which
unit it was hitting, not the app misbehaving.

Verified end to end, not just via `pnpm check`: ran the built server
directly, subscribed to `/api/events` with curl, POSTed an enrol, and watched
the SSE event arrive — confirming the multi-tab live-update claim in
`README.md` against the real running artefact, the same one `spec/` and Fly
both use.

## Putting the real catalogue in

With the slice working on eight hand-written courses, I replaced them with
the actual ANU catalogue
([`4056540...da850e7`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-isaacboentoro/compare/4056540...da850e7)).

The grounding step was refusing to scrape. P&C's `/catalogue` renders its
result tables empty and fills them client-side, so rather than crawling six
thousand course pages I read the page's own markup for how it talks to its
backend: a `data-action="/data/CourseSearch/GetCourses"` attribute, and a
bundle that GETs it with `PageIndex`/`PageSize`/`ShowAll`. Asking that
endpoint directly with `ShowAll=true` returns an entire commencement year in
one JSON response. The whole import is two requests, and
`scripts/fetch-courses.ts` records how, so the data is reproducible rather
than a one-off dump.

Real data broke three of my assumptions at once, which is the useful part:

- **`code` isn't unique.** The same course is offered in 2026 and 2027, so
  the key became `(code, year)`.
- **6,000 rows isn't a page.** The single table I'd written was fine for
  eight courses and unusable for six thousand, so the catalogue became a
  server-rendered search — code/title with career and year filters, capped
  at 50 results with the true match count. Still a plain GET form; still no
  JavaScript needed.
- **Nothing stopped you enrolling in the same course twice.** My earlier
  spec had actually rendered two COMP1100 rows without me noticing it was
  wrong. Real data made it obvious, and it became the fourth rule.

The decision I want a marker to check hardest: **P&C publishes no class
sizes.** Capacity is the app's whole point, so I couldn't drop it, and
inventing numbers that sit in a table next to genuine ANU data is exactly
how a prototype misleads someone. I derived capacity and places-taken from a
hash of the course code — deterministic, so a reseed doesn't change what's
full and the spec can assert on a named course without re-implementing the
derivation — and then labelled it in the three places a reader will look:
under the table on the page, in `README.md`, and as a standing rule in
`CLAUDE.md`. The catalogue fields are ANU's; the places are mine, and the
app says so.

Verified the same way as before, against the built server: 6,003 rows
seeded in one transaction, first page load 0.25s, and each of the four
rejections exercised over HTTP — a full course (`COMP3600` 2026, 206/206),
a duplicate, the cap at 24cp, and the redirect carrying a search back to
where it started.

## Sessions, and looking like ANU

Two things were still wrong for an ANU system: the credit cap was global, so
four First Semester courses blocked a fifth in Second, and the page was plain
system-sans on white.

Both were fixed by reading ANU's own published output rather than guessing.
The session vocabulary came out of the catalogue itself — ten tokens, ordered
the way P&C's own multi-session strings order them. The palette and type came
from ANU's live stylesheet (`.../htmlsites/pc.css`): Public Sans, ANU gold
`#be830e`, black, `#767676`, `#ebebeb`. Nothing in the theme is a colour I
picked.

Two limits I set myself there, and kept:

- **Gold never carries small text on white.** `#be830e` on white is about
  4.0:1, under the 4.5:1 floor, so gold is confined to rules, chips, focus
  rings and button fills, and gold buttons take black text.
- **No ANU crest, logo or wordmark.** Borrowing a design language is fair for
  a prototype of an ANU system; wearing the identity marks would make it read
  as the real thing. The footer says it's a student prototype.

The migration was the part I was most careful about, because by then the
deployed volume held four real enrolments — including `ASIA2065 (2027)`,
whose course P&C gives no session, and which the new "no session means not
offered" rule would refuse. Recreating the table would have been simpler and
would have thrown that away. Instead the column was *added* with a default
(`ALTER TABLE ... ADD`, safe on populated tables) and a boot-time backfill
gives each old enrolment its course's first session, parking the
sessionless one under `Not published`, outside every cap, droppable but not
re-enrollable. I proved it before deploying by building the old state in a
scratch database, restarting, and checking all four rows survived with the
right sessions and none left blank.

The test that actually pins the feature down isn't that the cap refuses —
it's that it refuses *and then lets the next one through*: fill First
Semester to 24cp, watch a fifth First Semester course bounce, then watch a
Second Semester course succeed. A global cap passes the first half of that
and fails the second.

## Before you ship

`pnpm check:evidence` passing, `pnpm check` green, deployed to
`comp4020-crit7-isaacboentoro.fly.dev`.
