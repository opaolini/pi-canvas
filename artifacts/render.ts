/** Headless-Chrome render check. Chrome on this machine writes the screenshot and then never exits,
 *  so we poll for the PNG, then kill the process and remove the throwaway profile. */
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

export type RenderResult = { ok: boolean; skipped?: boolean; message: string; console: string[] };

const CANDIDATES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chromium-browser"];

export function findChrome(): string | null {
  if (process.env.KB_CHROME) return existsSync(process.env.KB_CHROME) ? process.env.KB_CHROME : null;
  for (const c of CANDIDATES) {
    if (c.startsWith("/")) { if (existsSync(c)) return c; continue; }
    const hit = Bun.which(c);
    if (hit) return hit;
  }
  return null;
}

export async function render(file: string, png: string, timeoutMs = 15000): Promise<RenderResult> {
  const chrome = findChrome();
  if (!chrome) return { ok: true, skipped: true, message: "render skipped (no Chrome found; set KB_CHROME)", console: [] };

  rmSync(png, { force: true });
  mkdirSync(dirname(png), { recursive: true });
  const profile = `${tmpdir()}/kb-artifact-${process.pid}-${Date.now()}`;
  let stderr = "";
  const proc = spawn(chrome, [
    "--headless", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profile}`, "--hide-scrollbars",
    `--window-size=${process.env.KB_RENDER_SIZE || "1280,2000"}`, "--enable-logging=stderr", "--v=0", `--screenshot=${png}`, "file://" + file,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", (d) => { stderr += d; });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(existsSync(png) && statSync(png).size > 0)) await Bun.sleep(200);
  if (existsSync(png)) await Bun.sleep(600); // let trailing console lines flush
  try { proc.kill("SIGTERM"); await Bun.sleep(150); proc.kill("SIGKILL"); } catch {}
  rmSync(profile, { recursive: true, force: true });

  const consoleLines = stderr.split("\n").filter((l) => l.includes("CONSOLE")).map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim());
  if (!existsSync(png)) return { ok: false, message: `render timed out after ${timeoutMs} ms`, console: consoleLines };
  const bad = consoleLines.find((l) => l.includes("Uncaught ") || l.includes("[kb-error]"));
  if (bad) return { ok: false, message: `console error: ${bad}`, console: consoleLines };
  if (!consoleLines.some((l) => l.includes("[kb-ready]"))) return { ok: false, message: "runtime did not log [kb-ready]", console: consoleLines };
  return { ok: true, message: `rendered ${png}`, console: consoleLines };
}
