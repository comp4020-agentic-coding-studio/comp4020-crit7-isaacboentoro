#!/usr/bin/env node
// Refreshes src/data/courses.json from ANU Programs and Courses.
//
// P&C's catalogue page renders its result tables client-side from a backing
// endpoint (/data/CourseSearch/GetCourses, found in the markup of
// /catalogue as a data-action attribute). Asking that endpoint directly for
// ShowAll=true returns every course for one commencement year in a single
// JSON response, so this is two requests, not a crawl of 6000 pages.
//
// The catalogue publishes no class capacity — see src/lib/db.ts, which
// derives the prototype's own capacity numbers at seed time. Everything in
// the file this writes is P&C's.
import { writeFileSync } from "node:fs";

const YEARS = [2026, 2027];
const ENDPOINT = "https://programsandcourses.anu.edu.au/data/CourseSearch/GetCourses";
const OUT = "src/data/courses.json";

type PCCourse = {
  CourseCode: string;
  Name: string;
  Session: string;
  Career: string;
  Units: number;
  ModeOfDelivery: string;
  Year: number;
};

export type Course = {
  code: string;
  title: string;
  period: string;
  career: string;
  creditPoints: number;
  year: number;
};

async function fetchYear(year: number): Promise<PCCourse[]> {
  const url = `${ENDPOINT}?SelectedYear=${year}&ShowAll=true&PageIndex=0&PageSize=100`;
  const res = await fetch(url, {
    headers: { "user-agent": "comp4020-crit7-prototype (course catalogue import)" },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const body = (await res.json()) as { Items: PCCourse[] };
  return body.Items;
}

const courses: Course[] = [];
for (const year of YEARS) {
  const items = await fetchYear(year);
  console.log(`${year}: ${items.length} courses`);
  for (const item of items) {
    courses.push({
      code: item.CourseCode.trim(),
      // P&C pads a fair few titles with a leading space
      title: item.Name.trim(),
      period: item.Session.trim(),
      career: item.Career.trim(),
      creditPoints: Math.round(item.Units),
      year: item.Year,
    });
  }
}

courses.sort((a, b) => a.year - b.year || a.code.localeCompare(b.code));

const keys = new Set(courses.map((c) => `${c.code}:${c.year}`));
if (keys.size !== courses.length) {
  throw new Error(`code+year is not unique: ${courses.length} rows, ${keys.size} keys`);
}

writeFileSync(OUT, `${JSON.stringify(courses, null, 0)}\n`);
console.log(`wrote ${courses.length} courses to ${OUT}`);
