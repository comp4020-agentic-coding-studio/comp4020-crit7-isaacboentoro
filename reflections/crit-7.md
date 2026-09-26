# Crit 7

**Breakthrough:** treating the two annoying ANUhub behaviours (silent
overfill, silent over-cap) as the actual spec, not "add a database" as the
spec. Once I picked unit enrolment and named the two constraints that
actually cost me time, the schema, the one `enrol()` gatekeeper function, and
the test cases all fell out of that — instead of building generic CRUD and
bolting validation on afterwards. The moment it clicked was writing the
README's "what good looks like" section before touching more code: it forced
me to say which parts were spec-enforced (persistence, capacity, credit cap)
versus judgement calls (no auth, no prerequisites) before I'd over-built
either.

**What this changed about who I want to be as a developer:** I noticed my
first instinct was still to reach for `pnpm db:generate` and fix whatever it
complained about, rather than understanding why a non-interactive shell
couldn't satisfy an interactive rename prompt. Splitting the migration into
an unambiguous drop and an unambiguous add was a five-second decision once I
stopped treating the tool's complaint as an obstacle to route around and
asked what it was actually asking. I want that to be the default reflex —
with an agent doing the typing, it's easy to let "make the error go away"
substitute for "understand the constraint," and this is the week that made
the difference between those two visible to me.
