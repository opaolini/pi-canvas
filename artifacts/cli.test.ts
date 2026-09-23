import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RUNTIME_VERSION, backfillHtml, extractContent, findRoot, listArtifacts, parseMeta, staticCheck, wrap } from "./lib.ts";
import { addNote, addReply, loadNotes, markSent, notesToCodexPrompt, notesToMarkdown, notesPath, saveNotes, unsent, updateNote, deleteNote } from "./notes.ts";
import { runningSession, serve, stateFile } from "./session.ts";

const TOOL = import.meta.dir;
const runtime = { css: readFileSync(join(TOOL, "runtime/tokens.css"), "utf8") + readFileSync(join(TOOL, "runtime/base.css"), "utf8"), js: readFileSync(join(TOOL, "runtime/runtime.js"), "utf8") };
const meta = { type: "explainer", slug: "t", date: "2026-09-02", title: "T", subject: "demo", sources: "https://x.test", question: "q?" };
const filled = `<section id="a"><h2>A</h2><p>x</p></section><section id="b"><h2>B</h2></section><section id="c"><h2>C</h2></section>`;

// temp vault: wiki/ + assets/files with one referenced artifact and one legacy file
let vault: string;
beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), "artifact-root-"));
  mkdirSync(join(vault, "wiki/repos"), { recursive: true });
  mkdirSync(join(vault, "assets/files"), { recursive: true });
  writeFileSync(join(vault, "assets/files/linked-2026-09-02.html"), wrap(filled, { ...meta, slug: "linked" }, runtime));
  writeFileSync(join(vault, "assets/files/orphan-2026-09-02.html"), wrap(filled, { ...meta, slug: "orphan" }, runtime));
  writeFileSync(join(vault, "assets/files/legacy.html"), `<!doctype html><html><head><title>Old</title><style>body{}</style></head><body><h1>old</h1></body></html>`);
  writeFileSync(join(vault, "wiki/repos/demo.md"), `see [brief](../../assets/files/linked-2026-09-02.html)`);
});
afterAll(() => rmSync(vault, { recursive: true, force: true }));

describe("wrap / extract / rebuild", () => {
  test("document shape and byte-preserved content", () => {
    const html = wrap(filled, meta, runtime);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`<meta name="kb:runtime" content="${RUNTIME_VERSION}">`);
    expect(html).toContain('data-theme="light"');
    expect(extractContent(html)).toBe(filled);
    const m = parseMeta(html);
    expect(m.type).toBe("explainer"); expect(m.title).toBe("T"); expect(m.theme).toBe("light");
  });
  test("rebuild is idempotent and keeps dark theme", () => {
    const one = wrap(filled, { ...meta, theme: "dark" }, runtime);
    const two = wrap(extractContent(one)!, parseMeta(one), runtime);
    expect(two).toBe(one);
    expect(two).toContain('data-theme="dark"');
  });
  test("escapes meta values", () => {
    const html = wrap("x", { ...meta, title: `a<b>"c"` }, runtime);
    expect(html).toContain("<title>a&lt;b&gt;&quot;c&quot;</title>");
  });
});

describe("staticCheck", () => {
  const ok = wrap(filled, meta, runtime);
  test("filled artifact passes", () => { expect(staticCheck(ok).errors).toEqual([]); });
  test("catches external script/link/css/img/iframe", () => {
    expect(staticCheck(ok.replace("<body>", '<body><script src="https://cdn.x/y.js"></script>')).errors.join()).toContain("<script src>");
    expect(staticCheck(ok.replace("</head>", '<link rel="stylesheet" href="https://f.x/a.css"></head>')).errors.join()).toContain("<link href=http>");
    expect(staticCheck(ok.replace("<style>", "<style>@import url(https://f.x/a.css);")).errors.join()).toContain("@import");
    expect(staticCheck(ok.replace("<p>x</p>", '<img src="https://x/y.png">')).errors.join()).toContain("<img src=http>");
    expect(staticCheck(ok.replace("<p>x</p>", '<iframe src="a"></iframe>')).errors.join()).toContain("<iframe>");
  });
  test("catches missing meta, title, placeholders, oversize, stale runtime", () => {
    expect(staticCheck(ok.replace(/<meta name="kb:date"[^>]*>\n/, "")).errors).toContain("missing kb:date");
    expect(staticCheck(ok.replace(/<title>.*<\/title>/, "")).errors).toContain("missing <title>");
    expect(staticCheck(ok.replace("<p>x</p>", "<!-- kb:content -->")).errors.join()).toContain("placeholder");
    expect(staticCheck(ok.replace("<p>x</p>", "<p>{{todo}}</p>")).errors.join()).toContain("{{…}}");
    expect(staticCheck(ok.replace("<p>x</p>", '<!-- kb:diff:start --><pre>${{ github.sha }}</pre><!-- kb:diff:end -->')).errors).toEqual([]);
    expect(staticCheck(ok.replace("<p>x</p>", '<pre>${{ github.sha }}</pre>')).errors.join()).toContain("{{…}}");
    expect(staticCheck(ok.replace("<p>x</p>", "<p>" + "y".repeat(401 * 1024) + "</p>")).errors.join()).toContain("exceeds");
    expect(staticCheck(ok.replace(`content="${RUNTIME_VERSION}"`, 'content="0"')).errors.join()).toContain("older");
  });
  test("warns on no h2, empty sources, not linked", () => {
    const r = staticCheck(wrap("<p>x</p>", { ...meta, sources: "" }, runtime), vault, join(vault, "assets/files/orphan-2026-09-02.html"));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining("no <h2>"), "kb:sources empty", "not linked from wiki/"]));
  });
  test("every template scaffolds with only the intentional placeholder failure", () => {
    for (const t of readdirSync(join(TOOL, "templates"))) {
      const html = wrap(readFileSync(join(TOOL, "templates", t), "utf8"), meta, runtime);
      const errs = staticCheck(html).errors.filter((e) => !e.includes("placeholder"));
      expect(errs, t).toEqual([]);
      // every JSON data component in the template must parse once placeholders are substituted
      for (const m of html.matchAll(/data-component="(\w+)">([\s\S]*?)<\/script>/g)) expect(() => JSON.parse(m[2].replace(/{{[^}]+}}/g, "x")), `${t}:${m[1]}`).not.toThrow();
    }
  });
});

describe("vault helpers", () => {
  test("findRoot walks up", () => { expect(findRoot(join(vault, "assets/files/legacy.html"))).toBe(vault); });
  test("list reports type/date/runtime/linked", () => {
    const rows = listArtifacts(vault);
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(by.linked).toMatchObject({ type: "explainer", date: "2026-09-02", runtime: String(RUNTIME_VERSION), linked: true });
    expect(by.orphan.linked).toBe(false);
    expect(by.legacy).toMatchObject({ type: "unknown", runtime: "none", linked: false });
  });
  test("backfill inserts then replaces meta without touching body", () => {
    const legacy = readFileSync(join(vault, "assets/files/legacy.html"), "utf8");
    const once = backfillHtml(legacy, { type: "report", slug: "legacy", date: "2026-07-01", subject: "kms", sources: "", question: "q" });
    expect(once).toContain('<meta name="kb:runtime" content="legacy">');
    expect(once).toContain("<h1>old</h1>");
    const twice = backfillHtml(once, { type: "brief", slug: "legacy", date: "2026-07-01", subject: "kms", sources: "", question: "q" });
    expect(twice.match(/kb:type/g)!.length).toBe(1);
    expect(twice).toContain('content="brief"');
    expect(parseMeta(twice).runtime).toBe("legacy");
  });
});

describe("notes sidecar", () => {
  test("add / reply / send / resolve round-trip through the file", () => {
    const f = join(vault, "assets/files/linked-2026-09-02.html");
    let d = loadNotes(f, "linked");
    expect(d.notes).toEqual([]);
    const n = addNote(d, { kind: "question", text: "why not auto-rebuild?", anchor: { section: "gotchas", heading: "Gotchas", quote: "check does not rebuild" } });
    addNote(d, { kind: "approve", text: "looks right" });
    saveNotes(f, d);
    expect(notesPath(f)).toEndWith("linked-2026-09-02.notes.json");
    d = loadNotes(f, "linked");
    expect(d.notes.length).toBe(2); expect(unsent(d).length).toBe(2);
    markSent(d, [n.id]); expect(unsent(d).length).toBe(1); expect(d.notes[0].status).toBe("sent");
    addReply(d, n.id, "agent", "because build and verify are separate steps");
    expect(d.notes[0].status).toBe("answered"); expect(d.notes[0].replies[0].by).toBe("agent");
    updateNote(d, n.id, { status: "resolved" }); expect(d.notes[0].status).toBe("resolved");
    deleteNote(d, d.notes[1].id); expect(d.notes.length).toBe(1);
    expect(() => deleteNote(d, "nope")).toThrow();
  });
  test("markdown rendering", () => {
    const d = loadNotes(join(vault, "assets/files/orphan-2026-09-02.html"), "orphan");
    const n = addNote(d, { kind: "change", text: "rename this\nand that", anchor: { heading: "Summary", quote: "x".repeat(200) } });
    addReply(d, n.id, "agent", "done");
    const md = notesToMarkdown(d, d.notes, { relPath: "assets/files/orphan.html" });
    expect(md).toContain("**Artifact review** `orphan` — 1 note from the reviewer (assets/files/orphan.html)");
    expect(md).toContain("1. ✏️ **change** `" + n.id + "` in “Summary” › “" + "x".repeat(139) + "…”");
    expect(md).toContain("   > rename this\n   > and that");
    expect(md).toContain("↳ *agent*");
    expect(md).toContain("artifact reply orphan <id>");
    expect(notesToMarkdown(d, d.notes, { header: false })).not.toContain("Artifact review");
  });
  test("portable Codex prompt keeps the canonical sidecar and every note ID", () => {
    const d = loadNotes(join(vault, "assets/files/orphan-2026-09-02.html"), "orphan");
    const first = addNote(d, { id: "nalpha", kind: "question", text: "keep <this> safe", anchor: { heading: "Summary" } });
    const second = addNote(d, { id: "nbeta", kind: "change", text: "change it" });
    markSent(d, [first.id]);
    const prompt = notesToCodexPrompt(d, d.notes, { relPath: "assets/files/orphan-2026-09-02.html" });
    expect(prompt).toContain("artifact `orphan` at `assets/files/orphan-2026-09-02.html`");
    expect(prompt).toContain("canonical notes file is `assets/files/orphan-2026-09-02.notes.json`");
    expect(prompt).toContain("`nalpha`, `nbeta`");
    expect(prompt).toContain("Do not treat this pasted prompt as a delivered Pi message");
    expect(prompt).toContain("keep <this> safe");
    expect(d.notes.map((n) => n.status)).toEqual(["sent", "open"]);
  });
});

describe("portable session exports", () => {
  test("detached session remains usable after its launcher exits", async () => {
    const args = [process.execPath, join(TOOL, "cli.ts"), "session", "linked", "--detach", "--no-open"];
    const launcher = Bun.spawn(args, { cwd: vault, stdout: "pipe", stderr: "pipe" });
    try {
      expect(await launcher.exited).toBe(0);
      const state = runningSession(vault, "linked");
      expect(state).not.toBeNull();
      expect((await fetch(`http://127.0.0.1:${state!.port}/export?format=json`)).status).toBe(200);
    } finally {
      const state = runningSession(vault, "linked");
      if (state) process.kill(state.pid);
      rmSync(stateFile(vault, "linked"), { force: true });
    }
  });
  test("serve Markdown, JSON, and Codex prompt without an intercom client", async () => {
    const file = join(vault, "assets/files/orphan-2026-09-02.html");
    const data = loadNotes(file, "orphan");
    addNote(data, { id: "nportable", kind: "note", text: "export this" });
    saveNotes(file, data);
    const server = await serve({ root: vault, file, slug: "orphan", open: false });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const page = await (await fetch(base + "/")).text();
      const markdown = await (await fetch(base + "/export?format=markdown")).text();
      const json = await (await fetch(base + "/export?format=json")).json() as any;
      const prompt = await (await fetch(base + "/export?format=prompt")).text();
      expect(markdown).toContain("export this");
      expect(page).toContain("Copy Codex follow-up");
      expect(page).toContain("Pi intercom");
      expect(page).toContain("optional");
      expect(json.notes[0]).toMatchObject({ id: "nportable", status: "open" });
      expect(prompt).toContain("`nportable`");
      expect(loadNotes(file, "orphan").notes[0].status).toBe("open");
    } finally {
      server.stop(true);
      rmSync(stateFile(vault, "orphan"), { force: true });
    }
  });
});

describe("local review", () => {
  test("collect → split → block → replace, with file:line notes", async () => {
    const { collectDiff, splitDiff, diffBlock, replaceBlock, reviewSkeleton, DIFF_START } = await import("./review.ts");
    const { spawnSync } = await import("node:child_process");
    const repo = mkdtempSync(join(tmpdir(), "kb-repo-"));
    const g = (...a: string[]) => spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...a]);
    g("init", "-q", "-b", "main"); writeFileSync(join(repo, "a.ts"), "one\ntwo\n"); g("add", "."); g("commit", "-qm", "init");
    g("checkout", "-qb", "feat"); writeFileSync(join(repo, "a.ts"), "one\n2</script>\n"); g("commit", "-qam", "change");
    writeFileSync(join(repo, "new.ts"), "fresh\n"); writeFileSync(join(repo, "bun.lock"), "x\n");
    const d = collectDiff(repo);
    const files = splitDiff(d.text);
    expect(files.map((f) => f.file).sort()).toEqual(["a.ts", "bun.lock", "new.ts"]);
    expect(files.find((f) => f.file === "bun.lock")!.skipped).toBe("generated/lockfile");
    expect(files.find((f) => f.file === "a.ts")).toMatchObject({ adds: 1, dels: 1 });
    expect(d).toMatchObject({ ref: "main", branch: "feat", dirty: true });
    const block = diffBlock(files, { ...d, repo: "r" });
    expect(block).toContain("2\\u003c/script>"); // escaped inside JSON
    const html = wrap(reviewSkeleton(block), { ...meta, type: "review", slug: "rv" }, runtime);
    expect(staticCheck(html).errors.some((e) => e.includes("placeholder"))).toBe(true); // agent must fill the rest
    const kept = replaceBlock("<p>mine</p>\n" + block, DIFF_START + "\nNEW\n<!-- kb:diff:end -->");
    expect(kept).toBe("<p>mine</p>\n" + DIFF_START + "\nNEW\n<!-- kb:diff:end -->");
    rmSync(repo, { recursive: true, force: true });
    const data = { artifact: "x.html", slug: "x", notes: [], updated: "" } as any;
    addNote(data, { kind: "change", text: "rename", anchor: { file: "a.ts", line: "2-3", side: "new", quote: "2" } });
    expect(notesToMarkdown(data)).toContain("`a.ts:2-3`");
  });
});
