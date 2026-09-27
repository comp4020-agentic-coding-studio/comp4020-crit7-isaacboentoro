#!/usr/bin/env node
// Refreshes src/data/requisites.json from ANU Programs and Courses.
//
// Unlike the catalogue itself (scripts/fetch-courses.ts, two requests for
// all 6,003 courses), requisites have no bulk endpoint — they exist only as
// prose on each course page, under the "Requisite and Incompatibility"
// heading. So this is a real crawl, and it is deliberately scoped: one
// subject at a time, one request at a time, with a pause between.
//
// Usage: pnpm requisites:fetch [SUBJECT ...]     (default: COMP)
//
// Widening coverage is a matter of passing more subjects; everything not
// fetched simply carries no requisite in the app rather than a wrong one.
import { readFileSync, writeFileSync } from "node:fs";
import { parseRequisite } from "../src/lib/requisites.ts";

const SUBJECTS = process.argv.slice(2).map((s) => s.toUpperCase());
const subjects = SUBJECTS.length > 0 ? SUBJECTS : ["COMP"];
const DELAY_MS = 400;
const OUT = "src/data/requisites.json";

type Course = { code: string; year: number };
type Requisite = { code: string; year: number; text: string; rule: unknown };

const catalogue: Course[] = JSON.parse(readFileSync("src/data/courses.json", "utf8"));
const wanted = catalogue.filter((course) =>
  subjects.some((subject) => course.code.startsWith(subject)),
);

console.log(`${wanted.length} course pages to fetch for ${subjects.join(", ")}`);

// The section sits under an anchor named "incompatibility" and runs up to
// the next heading; strip tags and collapse whitespace to get the prose.
function extract(html: string): string | null {
  const section = html.match(/id="incompatibility"([\s\S]{0,2000})/);
  if (!section) return null;
  const text = section[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .replace(/^>?\s*Requisite and Incompatibility\s*/i, "")
    .split(/Prescribed Texts|Assumed Knowledge/)[0]
    .trim();
  return text || null;
}

const out: Requisite[] = [];
let failures = 0;

for (const [index, course] of wanted.entries()) {
  const url = `https://programsandcourses.anu.edu.au/${course.year}/course/${course.code}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "comp4020-crit7-prototype (course requisite import)" },
    });
    if (!res.ok) throw new Error(`responded ${res.status}`);
    const text = extract(await res.text());
    if (text) {
      out.push({ code: course.code, year: course.year, text, rule: parseRequisite(text) });
    }
  } catch (error) {
    failures++;
    console.warn(`  ${course.code} ${course.year}: ${(error as Error).message}`);
  }
  if ((index + 1) % 25 === 0) console.log(`  ${index + 1}/${wanted.length}`);
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
}

out.sort((a, b) => a.year - b.year || a.code.localeCompare(b.code));
writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`);

const enforced = out.filter((r) => r.rule !== null).length;
console.log(
  `wrote ${out.length} requisites to ${OUT} — ${enforced} parse into an enforceable rule, ` +
    `${out.length - enforced} are displayed only, ${failures} failed`,
);
