# Process overview

## What I built

An enrolment slice of ANUhub: a seeded unit catalog, enrol/drop against it,
persisted in SQLite, with unit capacity and the 18 credit-point session cap
enforced server-side.

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

## Before you ship

`pnpm check:evidence` passing, `pnpm check` green, deployed to
`comp4020-crit7-isaacboentoro.fly.dev`.
