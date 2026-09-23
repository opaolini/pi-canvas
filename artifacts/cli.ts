#!/usr/bin/env bun
/** artifact — CLI for self-contained HTML artifacts in <root>/assets/files/. Contract: SPEC.md. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { backfillHtml, extractContent, findRoot, listArtifacts, parseMeta, staticCheck, wrap, RUNTIME_VERSION, type Meta } from "./lib.ts";
import { render } from "./render.ts";
import { addReply, loadNotes, notesToCodexPrompt, notesToMarkdown, saveNotes, updateNote } from "./notes.ts";

const TOOL = import.meta.dir;
const argv = process.argv.slice(2);
const cmd = argv[0];
const BOOL_FLAGS = ["--open", "--json", "--all", "--no-render", "--detach", "--no-open", "--url"];
const positional: string[] = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) { if (!BOOL_FLAGS.includes(a)) i++; continue; }
  positional.push(a);
}
const has = (f: string) => argv.includes(f);
const flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const today = () => new Date().toISOString().slice(0, 10);

type TypeDef = { title: string; purpose: string; sections: string[]; template: string; theme?: string };
const types: Record<string, TypeDef> = JSON.parse(readFileSync(join(TOOL, "types.json"), "utf8"));
const runtime = () => ({
  css: readFileSync(join(TOOL, "runtime/tokens.css"), "utf8") + "\n" + readFileSync(join(TOOL, "runtime/base.css"), "utf8"),
  js: readFileSync(join(TOOL, "runtime/runtime.js"), "utf8"),
});

const USAGE = `artifact — self-contained HTML artifacts (runtime v${RUNTIME_VERSION})

  new <type> <slug> [--title T] [--subject a,b] [--sources s1,s2] [--question Q] [--theme light|dark] [--date D] [--open]
  types | components
  check <file|slug>... | --all [--no-render] [--json]
  list [--json]
  rebuild <file|slug>... | --all
  backfill <file|slug> --type T [--subject ..] [--sources ..] [--question ..] [--date D]
  open <file|slug>
  review <slug> [--repo PATH] [--base REF] [--title T]                               local pre-PR review: git diff vs merge base → review artifact (re-run to refresh the diff)

  session <file|slug> [--to <pi-session-id|name>] [--port N] [--detach] [--no-open]   annotate in the browser → notes sent to a pi session
  session <file|slug> --url                                                           print the link for a running session, ?to= preselecting this pi session
  session --stop <slug>                                                               stop a detached session
  notes <file|slug> [--format markdown|json|prompt] [--json]                         export notes (Markdown by default; prompt is paste-ready for Codex)
  reply <file|slug> <noteId> "text"                                                   agent answers a note (page updates live)
  resolve <file|slug> <noteId>`;

function resolveFile(root: string, arg: string): string {
  if (existsSync(arg)) return resolve(arg);
  const dir = join(root, "assets/files");
  const exact = join(dir, arg.endsWith(".html") ? arg : arg + ".html");
  if (existsSync(exact)) return exact;
  const matches = readdirSync(dir).filter((n) => n.startsWith(arg + "-") && n.endsWith(".html"));
  if (matches.length === 1) return join(dir, matches[0]);
  if (matches.length > 1) throw new Error(`ambiguous "${arg}": ${matches.join(", ")}`);
  throw new Error(`not found: ${arg}`);
}
const allFiles = (root: string) => readdirSync(join(root, "assets/files")).filter((n) => n.endsWith(".html")).sort().map((n) => join(root, "assets/files", n));
const targets = (root: string) => (has("--all") ? allFiles(root) : positional.map((a) => resolveFile(root, a)));

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(USAGE); return; }
  if (cmd === "types") {
    for (const [k, v] of Object.entries(types)) console.log(`${k.padEnd(10)} ${v.purpose}\n${"".padEnd(11)}sections: ${v.sections.join(" · ") || "(free-form)"}${v.theme ? `  · theme: ${v.theme}` : ""}`);
    return;
  }
  if (cmd === "components") { process.stdout.write(readFileSync(join(TOOL, "COMPONENTS.md"), "utf8")); return; }

  const root = findRoot();
  mkdirSync(join(root, "assets/files"), { recursive: true });

  if (cmd === "new") {
    const [type, slug] = positional;
    if (!type || !types[type]) { console.error(`unknown type "${type ?? ""}". Valid: ${Object.keys(types).join(", ")}`); process.exitCode = 2; return; }
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error("slug must be lowercase letters, digits, and dashes"); process.exitCode = 2; return; }
    const date = flag("--date") || today();
    const out = join(root, "assets/files", `${slug}-${date}.html`);
    if (existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
    const content = readFileSync(join(TOOL, "templates", types[type].template), "utf8").trimEnd();
    const meta: Meta = {
      type, slug, date,
      title: flag("--title") || slug,
      subject: flag("--subject") || "",
      sources: flag("--sources") || "",
      question: flag("--question") || "",
      theme: flag("--theme") || types[type].theme || "light",
    };
    writeFileSync(out, wrap(content, meta, runtime()));
    console.log(`wrote ${out}\n--- content skeleton (edit between the kb:content markers) ---\n${content}`);
    if (has("--open")) Bun.spawn(["open", out]);
    return;
  }

  if (cmd === "list") {
    const rows = listArtifacts(root);
    const hasWiki = existsSync(join(root, "wiki"));
    if (has("--json")) { console.log(JSON.stringify(rows, null, 2)); return; }
    console.log(["slug", "type", "date", "runtime", "KB", "linked", "notes"].map((h) => h.padEnd(h === "slug" ? 54 : 11)).join(""));
    for (const r of rows) console.log(`${r.slug.padEnd(54)}${r.type.padEnd(11)}${r.date.padEnd(11)}${r.runtime.padEnd(11)}${String(Math.round(r.size / 1024)).padEnd(11)}${(r.linked ? "yes" : hasWiki ? "NO" : "-").padEnd(11)}${r.notes.total ? `${r.notes.total}${r.notes.open ? ` (${r.notes.open} open)` : ""}` : ""}`);
    return;
  }

  if (cmd === "check") {
    const files = targets(root);
    if (!files.length) { console.error("check: give files/slugs or --all"); process.exitCode = 2; return; }
    const rows: { file: string; errors: string[]; warnings: string[] }[] = [];
    let failed = false;
    for (const f of files) {
      const html = readFileSync(f, "utf8");
      const r = staticCheck(html, root, f);
      const m = parseMeta(html);
      if (!r.errors.length && !has("--no-render") && m.runtime !== "legacy") {
        const png = join(root, "assets/images/artifacts", basename(f, ".html") + ".png");
        const z = await render(f, png);
        if (!z.ok) r.errors.push(z.message); else r.warnings.push(z.message);
      }
      failed ||= r.errors.length > 0;
      rows.push({ file: f, ...r });
      console.log(`${r.errors.length ? "FAIL" : "OK  "} ${f}`);
      for (const e of r.errors) console.log(`     ✗ ${e}`);
      for (const w of r.warnings) console.log(`     · ${w}`);
    }
    if (has("--json")) console.log(JSON.stringify(rows, null, 2));
    if (failed) process.exitCode = 1;
    return;
  }

  if (cmd === "rebuild") {
    for (const f of targets(root)) {
      const html = readFileSync(f, "utf8");
      const m = parseMeta(html);
      const content = extractContent(html);
      if (!content || !m.runtime || m.runtime === "legacy") { console.log(`skip    ${f} (${m.runtime ?? "no runtime"})`); continue; }
      writeFileSync(f, wrap(content, m, runtime()));
      console.log(`rebuilt ${f} → v${RUNTIME_VERSION}`);
    }
    return;
  }

  if (cmd === "backfill") {
    const f = resolveFile(root, positional[0]);
    if (!flag("--type")) throw new Error("backfill requires --type");
    const html = readFileSync(f, "utf8");
    if (extractContent(html)) throw new Error("not a legacy file (has content markers); use rebuild");
    writeFileSync(f, backfillHtml(html, {
      type: flag("--type")!, slug: basename(f, ".html"), date: flag("--date") || today(),
      subject: flag("--subject") || "", sources: flag("--sources") || "", question: flag("--question") || "",
    }));
    console.log(`backfilled ${f}`);
    return;
  }

  if (cmd === "review") {
    const { collectDiff, diffBlock, replaceBlock, reviewSkeleton, splitDiff } = await import("./review.ts");
    const slug = positional[0];
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("usage: review <slug> [--repo PATH] [--base REF]");
    const repo = resolve(flag("--repo") || ".");
    const d = collectDiff(repo, flag("--base"));
    const files = splitDiff(d.text);
    if (!files.length) throw new Error(`no changes in ${repo} vs ${d.ref}`);
    const block = diffBlock(files, { ...d, repo: basename(repo) });
    let existing: string | undefined;
    try { existing = resolveFile(root, slug); } catch {}
    if (existing) {
      const html = readFileSync(existing, "utf8");
      const content = extractContent(html);
      if (!content) throw new Error(`${existing} has no content markers`);
      writeFileSync(existing, wrap(replaceBlock(content, block), parseMeta(html), runtime()));
      console.log(`refreshed diff in ${existing} (${files.length} files; open sessions reload)`);
      return;
    }
    const date = flag("--date") || today();
    const out = join(root, "assets/files", `${slug}-${date}.html`);
    writeFileSync(out, wrap(reviewSkeleton(block), {
      type: "review", slug, date, theme: "light",
      title: flag("--title") || `Local review: ${basename(repo)} ${d.branch}`,
      subject: basename(repo), sources: `${basename(repo)}@${d.branch}`, question: `Is ${d.branch} ready for a PR?`,
    }, runtime()));
    console.log(`wrote ${out} (${files.length} files)\nFill Verdict / Findings / Checklist (placeholders outside the kb:diff markers), then: artifact check ${slug} && artifact session ${slug} --detach`);
    return;
  }

  if (cmd === "open") { Bun.spawn(["open", resolveFile(root, positional[0])]); return; }

  if (cmd === "session") {
    const { runningSession, sessionUrl, stateFile } = await import("./session.ts");
    const to = flag("--to") || process.env.PI_INTERCOM_SESSION_ID || undefined;
    if (flag("--stop")) {
      const st = runningSession(root, flag("--stop")!);
      if (!st) { console.log("no running session for " + flag("--stop")); return; }
      try { process.kill(st.pid); console.log(`stopped ${flag("--stop")} (pid ${st.pid})`); } catch (e: any) { console.log("not running (" + e.code + ")"); }
      require("node:fs").rmSync(stateFile(root, flag("--stop")!), { force: true }); return;
    }
    const f = resolveFile(root, positional[0]);
    const slug = parseMeta(readFileSync(f, "utf8")).slug || basename(f, ".html");
    const existing = runningSession(root, slug);
    if (existing) { // reuse: print/open a link that preselects this pi session as the recipient
      const u = sessionUrl(existing.port, to);
      console.log(`session already running (pid ${existing.pid})\n  url:     ${u}${has("--url") ? "" : "\n  opened in the browser; --stop " + slug + " to end it"}`);
      if (!has("--url") && !has("--no-open")) Bun.spawn(["open", u]);
      return;
    }
    if (has("--url")) { console.log("no running session; start one with: artifact session " + slug + " --detach"); process.exitCode = 1; return; }
    if (has("--detach")) {
      // A separate process group and closed stdio survive native harness command cleanup.
      const child = spawn(process.execPath, [join(TOOL, "cli.ts"), "session", f, ...(to ? ["--to", to] : []), ...(flag("--port") ? ["--port", flag("--port")!] : []), ...(has("--no-open") ? ["--no-open"] : [])],
        { detached: true, stdio: "ignore", env: { ...process.env, KB_SESSION_DETACHED: "1" } });
      let launchError: Error | undefined;
      child.on("error", error => { launchError = error; });
      child.unref();
      const until = Date.now() + 4000;
      while (!launchError && child.exitCode === null && Date.now() < until) {
        const started = runningSession(root, slug);
        if (started?.pid === child.pid) {
          console.log(`artifact session · ${f}\n  url:     ${sessionUrl(started.port, to)}\n  pid:     ${child.pid} (detached)\n  stop:    artifact session --stop ${slug}`);
          return;
        }
        await Bun.sleep(50);
      }
      child.kill();
      throw new Error("Detached session did not start; run without --detach to inspect startup errors." + (launchError ? " " + launchError.message : ""));
    }
    const { serve } = await import("./session.ts");
    await serve({ root, file: f, slug, to, port: flag("--port") ? Number(flag("--port")) : undefined, open: !has("--no-open") });
    await new Promise(() => {}); // run until Ctrl-C
  }

  if (cmd === "notes" || cmd === "reply" || cmd === "resolve") {
    const f = resolveFile(root, positional[0]);
    const slug = parseMeta(readFileSync(f, "utf8")).slug || basename(f, ".html");
    const data = loadNotes(f, slug);
    if (cmd === "notes") {
      const format = has("--json") ? "json" : flag("--format") || "markdown";
      const relPath = `assets/files/${basename(f)}`;
      if (!(["markdown", "json", "prompt"] as string[]).includes(format)) throw new Error("notes --format must be markdown, json, or prompt");
      if (format === "json") console.log(JSON.stringify(data, null, 2));
      else if (format === "prompt") console.log(notesToCodexPrompt(data, data.notes, { relPath }));
      else console.log(data.notes.length ? notesToMarkdown(data, data.notes, { relPath, header: true }) : "(no notes)");
      return;
    }
    const id = positional[1]; if (!id) throw new Error(`usage: ${cmd} <file|slug> <noteId>${cmd === "reply" ? ' "text"' : ""}`);
    if (cmd === "reply") { const text = positional.slice(2).join(" "); if (!text) throw new Error("reply text required"); addReply(data, id, "agent", text); }
    else updateNote(data, id, { status: "resolved" });
    saveNotes(f, data); console.log(`${cmd === "reply" ? "replied to" : "resolved"} ${id} in ${basename(f).replace(/\.html$/, ".notes.json")}`); return;
  }

  console.error(`unknown command "${cmd}"\n${USAGE}`);
  process.exitCode = 2;
}

main().catch((e) => { console.error(`artifact: ${e.message}`); process.exitCode = 1; });
