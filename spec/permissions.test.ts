import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, scratchDatabase } from "./server";

// A permission code is an exception a convener grants, so what matters most
// is what it *doesn't* open: another course, another rule, or a second use.
//
// These run against their own server and database rather than the shared
// one: the codes here are single-use, and the enrolments pile a session up
// to its cap, so leaving that in the database other spec files read would
// make them fail depending on the order vitest happened to pick.
let baseUrl: string;
let stop: () => void;

beforeAll(async () => {
  ({ baseUrl, stop } = await boot(scratchDatabase("permissions")));
}, 60_000);

afterAll(() => stop?.());

const post = (path: string, body?: URLSearchParams) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body,
    redirect: "manual",
  });

const page = async (query = "") => (await fetch(new URL(`/${query}`, baseUrl))).text();
const enrolled = (html: string) => html.split("<h2>Completed courses</h2>")[0];

async function unitId(code: string, year = 2026): Promise<string> {
  const html = await page(`?q=${code}&year=${year}`);
  const id = html.match(new RegExp(`<tr data-unit-id="(\\d+)"><td><strong>${code}</strong>`))?.[1];
  if (!id) throw new Error(`${code} (${year}) not found`);
  return id;
}

const enrol = (id: string, session: string, permissionCode?: string) =>
  post(
    "/api/enrolments",
    new URLSearchParams({
      unitId: id,
      enrolSession: session,
      ...(permissionCode ? { permissionCode } : {}),
    }),
  );

const reasonOf = (res: Response) => new URL(res.headers.get("location") ?? "", baseUrl).searchParams;

const FIRST = "First Semester";
const SECOND = "Second Semester";

describe("prerequisites", () => {
  it("blocks a course whose prerequisites aren't met, and says which", async () => {
    // COMP1110 requires COMP1100 or COMP1130 or COMP1730
    const res = await enrol(await unitId("COMP1110"), FIRST);
    expect(reasonOf(res).get("error")).toBe("prereq");

    const row = await page("?q=COMP1110&year=2026");
    expect(row).toContain("Need COMP1100 or COMP1130 or COMP1730");
  });

  it("lets you in once the prerequisite is recorded as completed", async () => {
    await post("/api/completed", new URLSearchParams({ code: "COMP1130" }));
    expect(await page()).toContain("<strong>COMP1130</strong>");

    const res = await enrol(await unitId("COMP1110"), FIRST);
    expect(res.headers.get("location")).toBe("/");
    const html = await page();
    expect(enrolled(html)).toContain("COMP1110");

    // put it back to blocked, so the code tests below start from a state
    // where COMP1110 is refused on prerequisites rather than as a duplicate
    const drop = enrolled(html).match(/COMP1110[\s\S]*?\/api\/enrolments\/(\d+)\/drop/)?.[1];
    await post(`/api/enrolments/${drop}/drop`);
    await post("/api/completed/COMP1130/remove");
    expect(reasonOf(await enrol(await unitId("COMP1110"), FIRST)).get("error")).toBe("prereq");
  });

  it("only enforces a requisite it could parse unambiguously", async () => {
    // COMP2100's requirement includes "6 units of 1000 level MATH", which is
    // shown but deliberately not machine-checked
    const row = await page("?q=COMP2100&year=2026");
    expect(row).toContain("6 units of 1000 level MATH");
    expect(row).toContain("not machine-checked here");

    const res = await enrol(await unitId("COMP2100"), FIRST);
    expect(reasonOf(res).get("error")).not.toBe("prereq");
  });
});

describe("permission codes", () => {
  it("gets you into a course with no places left", async () => {
    const full = await unitId("COMP3600");
    expect(reasonOf(await enrol(full, SECOND)).get("error")).toBe("full");

    const res = await enrol(full, SECOND, "FULL-3600-A");
    expect(reasonOf(res).get("used")).toBe("FULL-3600-A");

    // the banner lives on the page the redirect lands on
    const landed = await (await fetch(new URL(res.headers.get("location") ?? "", baseUrl))).text();
    expect(landed).toContain("now been used");
    expect(enrolled(landed)).toContain("COMP3600");
  });

  it("refuses a code that has already been used", async () => {
    // the same code, now spent, on a course it was issued for
    const res = await enrol(await unitId("COMP1110"), FIRST, "FULL-3600-A");
    expect(reasonOf(res).get("error")).toBe("bad-code");
  });

  it("refuses a code issued for a different course", async () => {
    // FULL-3600-B belongs to COMP3600, not COMP1110
    const res = await enrol(await unitId("COMP1110"), FIRST, "FULL-3600-B");
    expect(reasonOf(res).get("error")).toBe("bad-code");
    expect(enrolled(await page())).not.toContain("COMP1110");
  });

  it("refuses a code that isn't real", async () => {
    const res = await enrol(await unitId("COMP1110"), FIRST, "NOT-A-CODE");
    expect(reasonOf(res).get("error")).toBe("bad-code");
  });

  it("lifts only the exception it was issued for", async () => {
    // PREQ-1110-A grants a prerequisite exception on COMP1110 — and COMP1110
    // is blocked on prerequisites, so it works
    const res = await enrol(await unitId("COMP1110"), FIRST, "PREQ-1110-A");
    expect(reasonOf(res).get("used")).toBe("PREQ-1110-A");
    expect(enrolled(await page())).toContain("COMP1110");
  });

  it("does not spend a code that wasn't needed", async () => {
    // COMP2310 has places and no parsed prerequisite, so an over-cap code
    // handed over when nothing is blocking should survive
    const res = await enrol(await unitId("COMP2310"), SECOND, "LOAD-2310-A");
    expect(res.headers.get("location")).toBe("/");
    expect(reasonOf(res).get("used")).toBeNull();

    // still usable: drop, fill the session, and redeem it for a real overload
    const html = await page();
    const drop = enrolled(html).match(/COMP2310[\s\S]*?\/api\/enrolments\/(\d+)\/drop/)?.[1];
    await post(`/api/enrolments/${drop}/drop`);

    for (const code of ["COMP1600", "COMP1730", "COMP2120"]) {
      await enrol(await unitId(code), SECOND);
    }
    // Second Semester now holds COMP3600 + three more = 24cp
    expect(await page()).toMatch(
      new RegExp(`data-session="${SECOND}"[\\s\\S]*?<span class="cap-used">24</span>`),
    );

    const blocked = await enrol(await unitId("COMP2310"), SECOND);
    expect(reasonOf(blocked).get("error")).toBe("over-cap");

    const overload = await enrol(await unitId("COMP2310"), SECOND, "LOAD-2310-A");
    expect(reasonOf(overload).get("used")).toBe("LOAD-2310-A");
    expect(await page()).toMatch(
      new RegExp(`data-session="${SECOND}"[\\s\\S]*?<span class="cap-used">30</span>`),
    );
  });
});
