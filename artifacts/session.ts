/** `artifact session`: serve one artifact on 127.0.0.1 with an injected annotation layer, persist
 *  notes to the sidecar, and deliver them to a pi session through the pi-intercom broker.
 *  The artifact file itself is never modified by a session. */
import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { addNote, addReply, deleteNote, loadNotes, markSent, notesToCodexPrompt, notesToMarkdown, saveNotes, unsent, updateNote, type NoteKind } from "./notes.ts";

const TOOL = import.meta.dir;
const INTERCOM_CLIENT = process.env.KB_INTERCOM_CLIENT || join(homedir(), ".pi/agent/npm/node_modules/pi-intercom/broker/client.ts");

/** Running-session state: assets/files/.session-<slug>.json = { pid, port, file, started }. */
export const stateFile = (root: string, slug: string) => join(root, "assets/files", `.session-${slug}.json`);
export const sessionUrl = (port: number, to?: string) => `http://127.0.0.1:${port}/${to ? `?to=${encodeURIComponent(to)}` : ""}`;
export function runningSession(root: string, slug: string): { pid: number; port: number; file: string } | null {
  const f = stateFile(root, slug);
  if (!existsSync(f)) return null;
  try {
    const st = JSON.parse(readFileSync(f, "utf8"));
    process.kill(st.pid, 0); // throws if not running
    return st;
  } catch { rmSync(f, { force: true }); return null; }
}

type Peer = { id: string; name?: string; cwd: string; status?: string; lastActivity: number; model?: string };

async function intercom(): Promise<any> {
  if (!existsSync(INTERCOM_CLIENT)) throw new Error(`pi-intercom client not found at ${INTERCOM_CLIENT} (set KB_INTERCOM_CLIENT)`);
  const mod = await import(INTERCOM_CLIENT);
  const client = new mod.IntercomClient();
  await client.connect({ name: "artifact-session", cwd: process.cwd(), model: "none", pid: process.pid, startedAt: Date.now(), lastActivity: Date.now(), status: "idle" });
  return client;
}

export async function listPeers(root: string): Promise<Peer[]> {
  const c = await intercom();
  try {
    const all: Peer[] = await c.listSessions();
    return all.filter((s) => s.name !== "artifact-session").sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)).map((s) => ({ ...s, cwd: s.cwd, sameCwd: s.cwd === root } as any));
  } finally { await c.disconnect(); }
}

export async function deliver(root: string, file: string, slug: string, to: string, ids?: string[]): Promise<{ delivered: boolean; count: number; reason?: string }> {
  const data = loadNotes(file, slug);
  const notes = ids ? data.notes.filter((n) => ids.includes(n.id)) : unsent(data);
  if (!notes.length) return { delivered: false, count: 0, reason: "no unsent notes" };
  const rel = relative(root, file);
  const text = notesToMarkdown(data, notes, { relPath: rel });
  const c = await intercom();
  try {
    const r = await c.send(to, { text, attachments: [{ type: "snippet", name: `${basename(file)}.notes.json (sent subset)`, content: JSON.stringify(notes, null, 2), language: "json" }] });
    if (r.delivered) { markSent(data, notes.map((n) => n.id)); saveNotes(file, data); }
    return { delivered: !!r.delivered, count: notes.length, reason: r.reason ?? r.code };
  } finally { await c.disconnect(); }
}

export async function serve(opts: { root: string; file: string; slug: string; to?: string; port?: number; open?: boolean }) {
  const { root, file, slug } = opts;
  // read per request so layer edits apply to an open session on reload
  const layerJs = () => readFileSync(join(TOOL, "runtime/annotate.js"), "utf8");
  const layerCss = () => readFileSync(join(TOOL, "runtime/annotate.css"), "utf8");
  let target = opts.to || process.env.PI_INTERCOM_SESSION_ID || "";
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
  const version = () => statSync(file).mtimeMs;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/") {
        const html = readFileSync(file, "utf8");
        const preselect = url.searchParams.get("to") || target; // ?to=<pi session id> pins the recipient for this tab
        const boot = `<style id="kb-annotate-css">${layerCss()}</style><script id="kb-annotate-js">window.__kbSession=${JSON.stringify({ slug, file: relative(root, file), target: preselect, pinned: url.searchParams.has("to"), version: version() })};\n${layerJs()}</script>`;
        return new Response(html.replace(/<\/body>/i, boot + "\n</body>"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (p === "/version") return json({ version: version() });
      if (p === "/notes" && req.method === "GET") return json(loadNotes(file, slug));
      if (p === "/export" && req.method === "GET") {
        const data = loadNotes(file, slug);
        const format = url.searchParams.get("format") || "markdown";
        const relPath = relative(root, file);
        if (format === "json") return new Response(JSON.stringify(data, null, 2) + "\n", { headers: { "content-type": "application/json; charset=utf-8" } });
        if (format === "prompt") return new Response(notesToCodexPrompt(data, data.notes, { relPath }), { headers: { "content-type": "text/plain; charset=utf-8" } });
        if (format === "markdown") return new Response(data.notes.length ? notesToMarkdown(data, data.notes, { relPath, header: true }) : "(no notes)", { headers: { "content-type": "text/markdown; charset=utf-8" } });
        return json({ error: "format must be markdown, json, or prompt" }, 400);
      }
      if (p === "/notes" && req.method === "POST") {
        const body = await req.json() as { kind: NoteKind; text: string; anchor?: any };
        if (!body.text?.trim()) return json({ error: "empty" }, 400);
        const data = loadNotes(file, slug); const n = addNote(data, body); saveNotes(file, data); return json(n);
      }
      const m = p.match(/^\/notes\/([a-z0-9]+)(?:\/(reply|delete))?$/);
      if (m) {
        const data = loadNotes(file, slug);
        if (m[2] === "delete" || req.method === "DELETE") { deleteNote(data, m[1]); saveNotes(file, data); return json({ ok: true }); }
        if (m[2] === "reply") { const b = await req.json() as { text: string }; const n = addReply(data, m[1], "reviewer", b.text); saveNotes(file, data); return json(n); }
        if (req.method === "PATCH") { const b = await req.json(); const n = updateNote(data, m[1], b); saveNotes(file, data); return json(n); }
      }
      if (p === "/peers") {
        try { return json({ target, peers: await listPeers(root) }); } catch (e: any) { return json({ target, peers: [], error: e.message }); }
      }
      if (p === "/target" && req.method === "POST") { target = ((await req.json()) as any).target || ""; return json({ target }); }
      if (p === "/send" && req.method === "POST") {
        const body = await req.json().catch(() => ({})) as { to?: string };
        const to = body.to || target;
        if (!to) return json({ error: "no target session selected" }, 400);
        try { return json(await deliver(root, file, slug, to)); } catch (e: any) { return json({ error: e.message }, 500); }
      }
      return new Response("not found", { status: 404 });
    },
  });
  const urlStr = sessionUrl(server.port!, target);
  writeFileSync(stateFile(root, slug), JSON.stringify({ pid: process.pid, port: server.port, file: relative(root, file), started: new Date().toISOString() }));
  console.log(`artifact session · ${relative(root, file)}\n  url:     ${urlStr}\n  notes:   ${relative(root, file).replace(/\.html$/, ".notes.json")}\n  target:  ${target || "(pick in the page)"}\n  stop:    Ctrl-C${process.env.KB_SESSION_DETACHED ? ` or artifact session --stop ${slug}` : ""}`);
  if (opts.open !== false) Bun.spawn(["open", urlStr]);
  return server;
}
