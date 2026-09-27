import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Booting the built server on a database of your own. Most spec files share
// the one global-setup.ts server, which is fine for reads and cheap writes —
// but a file that burns single-use permission codes, or rolls a database
// back to an older shape, needs its own or it leaks into everything else.
export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export function scratchDatabase(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `spec-${label}-`)), "app.db");
}

export async function boot(databasePath: string): Promise<{ baseUrl: string; stop: () => void }> {
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
