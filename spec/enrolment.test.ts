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

// Each catalogue row is <tr data-unit-id="N"><td>CODE</td>..., with no
// whitespace between tags, so this anchors to one specific course's row.
async function find(code: string, year = 2026): Promise<{ id: string; row: string }> {
  const html = await page(`?q=${code}&year=${year}`);
  const match = html.match(new RegExp(`<tr data-unit-id="(\\d+)"><td>${code}</td>[\\s\\S]*?</tr>`));
  if (!match) throw new Error(`${code} (${year}) not found in the catalogue`);
  return { id: match[1], row: match[0] };
}

const enrol = (unitId: string) => post("/api/enrolments", new URLSearchParams({ unitId }));

describe("catalogue", () => {
  it("seeds both published years of the ANU catalogue", async () => {
    const html = await page();
    const total = html.match(/<p id="result-count">(\d+) matching/);
    expect(Number(total?.[1])).toBeGreaterThan(5000);

    // the same course code is offered in more than one year
    const html2026 = await page("?q=COMP1100&year=2026");
    const html2027 = await page("?q=COMP1100&year=2027");
    expect(html2026).toContain("COMP1100");
    expect(html2027).toContain("COMP1100");
  });

  it("searches by course code and by words in the title", async () => {
    const byCode = await page("?q=COMP1100");
    expect(byCode).toContain("COMP1100");

    const byTitle = await page("?q=Algorithms");
    expect(byTitle).toMatch(/<td>[^<]*Algorithms[^<]*<\/td>/i);
  });

  it("matches each word of the query separately, in any order", async () => {
    // the searches a student actually types: a spaced course code, a word
    // the catalogue hyphenates, and two title words the wrong way round
    expect(await page("?q=COMP+1100")).toContain("COMP1100");
    expect(await page("?q=human+centred")).toMatch(/Human-Centred/i);

    const reversed = await page("?q=learning+machine");
    expect(reversed).toMatch(/Machine Learning/i);
  });

  it("narrows a search rather than rendering the whole catalogue", async () => {
    const all = await page();
    expect(all).toContain("showing the first 50");
    expect(all.match(/<tr data-unit-id=/g)?.length).toBe(50);
  });
});

describe("enrolment", () => {
  let comp1100: string;
  let comp1110: string;
  let comp2100: string;
  let comp2300: string;

  beforeAll(async () => {
    comp1100 = (await find("COMP1100")).id;
    comp1110 = (await find("COMP1110")).id;
    comp2100 = (await find("COMP2100")).id;
    comp2300 = (await find("COMP2300")).id;
  });

  it("refuses a course with no places left", async () => {
    // COMP3600 (2026) is one of the ~340 courses the seed derives as full;
    // the derivation is deterministic, so this stays true across reseeds.
    const { id, row } = await find("COMP3600");
    expect(row).toContain(">Full<");

    const res = await enrol(id);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?error=full");
    expect(enrolled(await page())).not.toContain("COMP3600");
  });

  it("enrolling persists across a reload", async () => {
    const res = await enrol(comp1100);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(enrolled(await page())).toContain("COMP1100");
  });

  it("refuses enrolling in the same course twice", async () => {
    const res = await enrol(comp1100);
    expect(res.headers.get("location")).toBe("/?error=duplicate");
    expect(enrolled(await page()).match(/COMP1100/g)).toHaveLength(1);
  });

  it("refuses enrolling past the credit point cap", async () => {
    await enrol(comp1110);
    const atCap = await enrol(comp2100); // 3 x 6cp = 18, right at the cap
    expect(atCap.headers.get("location")).toBe("/");
    expect(await page()).toContain('<span id="credit-count">18</span>');

    const overCap = await enrol(comp2300);
    expect(overCap.headers.get("location")).toBe("/?error=over-cap");

    const html = await page();
    expect(html).toContain('<span id="credit-count">18</span>');
    expect(enrolled(html)).not.toContain("COMP2300");
  });

  it("returns a rejected enrol to the search it came from", async () => {
    const res = await post(
      "/api/enrolments",
      new URLSearchParams({ unitId: comp2300, q: "COMP", career: "Undergraduate" }),
    );
    expect(res.headers.get("location")).toBe("/?q=COMP&career=Undergraduate&error=over-cap");
  });

  it("dropping persists across a reload", async () => {
    const html = await page();
    const id = enrolled(html).match(/COMP1100[\s\S]*?\/api\/enrolments\/(\d+)\/drop/)?.[1];
    expect(id).toBeDefined();

    const res = await post(`/api/enrolments/${id}/drop`);
    expect(res.status).toBe(303);
    expect(enrolled(await page())).not.toContain("COMP1100");
  });
});
