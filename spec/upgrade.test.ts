import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

// The other spec files run against a database this suite created, so they
// only ever exercise a *fresh* install. The deployed app is never fresh — it
// boots onto a volume seeded by an older version of this code, and that is
// the path that has broken in production: a migration added `unit_sessions`,
// but seeding skips a catalogue that is already there, so the table stayed
// empty and every course read as "not offered".
//
// So this boots the built server twice against one database, rolling it back
// to the older shape in between, and asserts the second boot repairs it.
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function boot(databasePath: string): Promise<{ baseUrl: string; stop: () => void }> {
  const port = await freePort();
  const server = spawn("node", ["./dist/server/entry.mjs"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATABASE_PATH: databasePath },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try {
      // the database work happens on the first request, not at listen
      if ((await fetch(baseUrl)).ok) break;
    } catch {
      // not up yet
    }
    if (attempt >= 50) {
      server.kill();
      throw new Error(`server did not come up at ${baseUrl}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { baseUrl, stop: () => server.kill() };
}

const countOf = (html: string) => Number(html.match(/<p id="result-count">(\d+) /)?.[1]);

describe("upgrading an existing database", () => {
  it("fills in sessions for a catalogue seeded before they existed", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "spec-upgrade-")), "app.db");

    const first = await boot(path);
    const enrol = async () => {
      const html = await (await fetch(new URL("/?q=COMP2620&year=2026", first.baseUrl))).text();
      const id = html.match(/<tr data-unit-id="(\d+)"><td><strong>COMP2620/)?.[1];
      await fetch(new URL("/api/enrolments", first.baseUrl), {
        method: "POST",
        headers: { origin: first.baseUrl },
        body: new URLSearchParams({ unitId: id ?? "", enrolSession: "First Semester" }),
        redirect: "manual",
      });
    };
    await enrol();
    first.stop();

    // roll the database back to what an older deploy left behind: the
    // catalogue seeded, the sessions table created but empty, and an
    // enrolment carrying no session
    const db = new Database(path);
    db.exec("delete from unit_sessions");
    db.exec("update enrolments set session = ''");
    expect(db.prepare("select count(*) as n from units").get()).toMatchObject({ n: 6003 });
    db.close();

    const second = await boot(path);
    try {
      const page = await (await fetch(new URL("/?session=First+Semester", second.baseUrl))).text();
      expect(countOf(page)).toBeGreaterThan(0);

      // the course is offered again, not stranded as "not offered"
      const row = await (await fetch(new URL("/?q=COMP2620&year=2026", second.baseUrl))).text();
      expect(row).toContain('<span class="chip">First Semester</span>');

      // and the enrolment that predated sessions kept its place
      expect(page).toContain("COMP2620");
      expect(page).toMatch(/data-session="First Semester"[\s\S]*?<span class="cap-used">6<\/span>/);
    } finally {
      second.stop();
    }
  }, 60_000);
});
