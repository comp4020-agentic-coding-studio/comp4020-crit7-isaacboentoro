import { beforeAll, describe, expect, inject, it } from "vitest";

// This app's own contracts, turned into checks per spec/README.md: what the
// page must do (persist, enforce capacity, enforce the credit cap), not how
// it's built. Drives the running app over HTTP against the seeded catalog.
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

const getPage = async () => (await fetch(baseUrl)).text();

// Each catalog row is <tr data-unit-id="N"><td>CODE</td>...>, with no
// whitespace between tags, so this anchors to the row for one specific code.
function unitId(html: string, code: string): string {
  const match = html.match(new RegExp(`<tr data-unit-id="(\\d+)"><td>${code}</td>`));
  if (!match) throw new Error(`seeded unit ${code} not found on the page`);
  return match[1];
}

function enrolmentIdFor(html: string, code: string): string {
  const match = html.match(new RegExp(`${code}[\\s\\S]*?/api/enrolments/(\\d+)/drop`));
  if (!match) throw new Error(`no enrolment row for ${code} on the page`);
  return match[1];
}

const enrol = (unitId: string) => post("/api/enrolments", new URLSearchParams({ unitId }));

describe("enrolment", () => {
  let comp8420: string; // seeded with capacity 1
  let comp1100: string; // seeded 6cp
  let math1115: string; // seeded 6cp

  beforeAll(async () => {
    const html = await getPage();
    comp8420 = unitId(html, "COMP8420");
    comp1100 = unitId(html, "COMP1100");
    math1115 = unitId(html, "MATH1115");
  });

  it("enrolling persists across a reload", async () => {
    const res = await enrol(comp8420);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const html = await getPage();
    const enrolledSection = html.split("<h2>Catalog</h2>")[0];
    expect(enrolledSection).toContain("COMP8420");
  });

  it("rejects enrolling past a unit's capacity", async () => {
    const res = await enrol(comp8420); // capacity 1, already taken above
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?error=full");

    const html = await getPage();
    const enrolledSection = html.split('<h2>Catalog</h2>')[0];
    expect(enrolledSection.match(/COMP8420/g)).toHaveLength(1);
  });

  it("rejects enrolling past the credit point cap", async () => {
    // COMP8420 (12cp) + COMP1100 (6cp) = 18, right at the cap.
    const atCap = await enrol(comp1100);
    expect(atCap.headers.get("location")).toBe("/");
    let html = await getPage();
    expect(html).toContain('<span id="credit-count">18</span>');

    // one more 6cp unit would push to 24
    const overCap = await enrol(math1115);
    expect(overCap.headers.get("location")).toBe("/?error=over-cap");

    html = await getPage();
    expect(html).toContain('<span id="credit-count">18</span>');
    const enrolledSection = html.split("<h2>Catalog</h2>")[0];
    expect(enrolledSection).not.toContain("MATH1115");
  });

  it("dropping persists across a reload", async () => {
    const html = await getPage();
    const id = enrolmentIdFor(html, "COMP1100");

    const res = await post(`/api/enrolments/${id}/drop`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const after = await getPage();
    const enrolledSection = after.split("<h2>Catalog</h2>")[0];
    expect(enrolledSection).not.toContain("COMP1100");
  });
});
