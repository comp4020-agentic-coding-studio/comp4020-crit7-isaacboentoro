import { beforeAll, describe, expect, inject, it } from "vitest";

// This app's own contracts, turned into checks per spec/README.md: what the
// page must do (find a course in the catalogue, persist an enrolment, refuse
// one that breaks a rule), not how it's built. Drives the running app over
// HTTP against the real ANU catalogue seeded from src/data/courses.json.
const baseUrl = inject("baseUrl");

// Astro checks form POSTs carry a same-origin Origin header (CSRF
// protection); browsers send it automatically, a bare fetch doesn't.
const post = (path: string, body?: URLSearchParams) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body,
    redirect: "manual",
  });

const page = async (query = "") => (await fetch(new URL(`/${query}`, baseUrl))).text();

const enrolled = (html: string) => html.split("<h2>Course catalogue</h2>")[0];

// Each catalogue row is <tr data-unit-id="N"><td><strong>CODE</strong>..., with
// no whitespace between tags, so this anchors to one specific course's row.
async function find(code: string, year = 2026): Promise<{ id: string; row: string }> {
  const html = await page(`?q=${code}&year=${year}`);
  const match = html.match(
    new RegExp(`<tr data-unit-id="(\\d+)"><td><strong>${code}</strong>[\\s\\S]*?</tr>`),
  );
  if (!match) throw new Error(`${code} (${year}) not found in the catalogue`);
  return { id: match[1], row: match[0] };
}

const enrol = (unitId: string, session: string) =>
  post("/api/enrolments", new URLSearchParams({ unitId, enrolSession: session }));

const FIRST = "First Semester";
const SECOND = "Second Semester";

describe("catalogue", () => {
  it("seeds both published years of the ANU catalogue", async () => {
    const html = await page();
    const total = html.match(/<p id="result-count">(\d+) matching/);
    expect(Number(total?.[1])).toBeGreaterThan(5000);

    expect(await page("?q=COMP1100&year=2026")).toContain("COMP1100");
    expect(await page("?q=COMP1100&year=2027")).toContain("COMP1100");
  });

  it("searches by course code and by words in the title", async () => {
    expect(await page("?q=COMP1100")).toContain("COMP1100");
    expect(await page("?q=Algorithms")).toMatch(/<td>[^<]*Algorithms[^<]*<\/td>/i);
  });

  it("matches each word of the query separately, in any order", async () => {
    // the searches a student actually types: a spaced course code, a word
    // the catalogue hyphenates, and two title words the wrong way round
    expect(await page("?q=COMP+1100")).toContain("COMP1100");
    expect(await page("?q=human+centred")).toMatch(/Human-Centred/i);
    expect(await page("?q=learning+machine")).toMatch(/Machine Learning/i);
  });

  it("narrows a search rather than rendering the whole catalogue", async () => {
    const all = await page();
    expect(all).toContain("showing the first 50");
    expect(all.match(/<tr data-unit-id=/g)?.length).toBe(50);
  });

  it("filters by session", async () => {
    const count = (html: string) => Number(html.match(/<p id="result-count">(\d+) /)?.[1]);
    const summer = await page("?session=Summer+Session");
    const all = await page();
    expect(count(summer)).toBeGreaterThan(0);
    expect(count(summer)).toBeLessThan(count(all));

    // COMP2300 is a First Semester course, so a Summer filter excludes it.
    // The search box echoes the term either way, so this asserts on the
    // results rather than the whole page.
    expect(count(await page("?q=COMP2300&year=2026&session=First+Semester"))).toBe(1);
    expect(count(await page("?q=COMP2300&year=2026&session=Summer+Session"))).toBe(0);
  });

  it("offers a session to pick when a course runs in more than one", async () => {
    const { row } = await find("COMP1100"); // First Semester / Second Semester
    expect(row).toContain('name="enrolSession"');
    expect(row).toContain(`<option value="${FIRST}">`);
    expect(row).toContain(`<option value="${SECOND}">`);

    // a single-session course needs no picker
    const single = await find("COMP2300");
    expect(single.row).toContain(`<input type="hidden" name="enrolSession" value="${FIRST}">`);
  });
});

describe("enrolment", () => {
  // 6cp 2026 COMP courses with places left: four fill First Semester, the
  // fifth must be refused, and the Second Semester one must still go through
  let first: string[];
  let fifthFirst: string;
  let secondSemester: string;
  let multiSession: string;

  beforeAll(async () => {
    first = [];
    for (const code of ["COMP1130", "COMP2300", "COMP2550", "COMP2620"]) {
      first.push((await find(code)).id);
    }
    fifthFirst = (await find("COMP2710")).id;
    secondSemester = (await find("COMP1600")).id;
    multiSession = (await find("COMP1100")).id;
  });

  it("refuses a course with no published session", async () => {
    const { id, row } = await find("COMP1710");
    expect(row).toContain("Not offered");

    const res = await enrol(id, FIRST);
    expect(res.headers.get("location")).toBe("/?error=not-offered");
  });

  it("refuses a session the course isn't offered in", async () => {
    // COMP2300 runs in First Semester only
    const res = await enrol((await find("COMP2300")).id, "Spring Session");
    expect(res.headers.get("location")).toBe("/?error=bad-session");
    expect(enrolled(await page())).not.toContain("COMP2300");
  });

  it("enrolling persists across a reload", async () => {
    const res = await enrol(first[0], FIRST);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(enrolled(await page())).toContain("COMP1130");
  });

  it("refuses enrolling in the same course twice", async () => {
    const res = await enrol(first[0], FIRST);
    expect(res.headers.get("location")).toBe("/?error=duplicate");
    expect(enrolled(await page()).match(/COMP1130/g)).toHaveLength(1);
  });

  it("refuses a course with no places left", async () => {
    // COMP3600 (2026) is one of the ~340 courses the seed derives as full;
    // the derivation is deterministic, so this stays true across reseeds.
    const { id, row } = await find("COMP3600");
    expect(row).toContain(">Full<");
    expect((await enrol(id, SECOND)).headers.get("location")).toBe("/?error=full");
  });

  it("caps each session on its own, not the whole enrolment", async () => {
    for (const id of first.slice(1)) {
      expect((await enrol(id, FIRST)).headers.get("location")).toBe("/");
    }

    // First Semester is now at 4 x 6cp
    const html = await page();
    expect(html).toMatch(
      new RegExp(`data-session="${FIRST}"[\\s\\S]*?<span class="cap-used">24</span>`),
    );

    // a fifth First Semester course is refused...
    expect((await enrol(fifthFirst, FIRST)).headers.get("location")).toBe("/?error=over-cap");

    // ...but Second Semester is a separate cap, so this one goes through
    expect((await enrol(secondSemester, SECOND)).headers.get("location")).toBe("/");
    const after = await page();
    expect(enrolled(after)).toContain("COMP1600");
    expect(after).toMatch(
      new RegExp(`data-session="${SECOND}"[\\s\\S]*?<span class="cap-used">6</span>`),
    );
  });

  it("puts a multi-session course in the session you picked", async () => {
    expect((await enrol(multiSession, SECOND)).headers.get("location")).toBe("/");
    const second = enrolled(await page()).split(`data-session="${SECOND}"`)[1];
    expect(second).toContain("COMP1100");
  });

  it("returns a rejected enrol to the search it came from", async () => {
    const res = await post(
      "/api/enrolments",
      new URLSearchParams({
        unitId: fifthFirst,
        enrolSession: FIRST,
        q: "COMP",
        career: "Undergraduate",
      }),
    );
    expect(res.headers.get("location")).toBe("/?q=COMP&career=Undergraduate&error=over-cap");
  });

  it("dropping persists across a reload", async () => {
    const html = await page();
    const id = enrolled(html).match(/COMP1130[\s\S]*?\/api\/enrolments\/(\d+)\/drop/)?.[1];
    expect(id).toBeDefined();

    const res = await post(`/api/enrolments/${id}/drop`);
    expect(res.status).toBe(303);
    expect(enrolled(await page())).not.toContain("COMP1130");
  });
});
