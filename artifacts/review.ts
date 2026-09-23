/** `artifact review`: render a local branch diff (committed + uncommitted + untracked vs. the merge base)
 *  as a `review` artifact whose Diff section is generated and the verdict/findings are written by the agent.
 *  Re-running replaces only the generated block, so the agent's findings and the reviewer's notes survive. */
import { spawnSync } from "node:child_process";

export const DIFF_START = "<!-- kb:diff:start -->";
export const DIFF_END = "<!-- kb:diff:end -->";
const SKIP = /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock)$|\.snap$|\.min\.(js|css)$/;
const MAX_FILE_LINES = 800; // ponytail: per-file and total caps keep the artifact under MAX_BYTES; page huge diffs if needed
const MAX_TOTAL_CHARS = 220_000;

export type FileDiff = { file: string; diff: string; adds: number; dels: number; skipped?: string };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jsonForScript = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");

function git(repo: string, args: string[], okCodes = [0]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (!okCodes.includes(r.status ?? -1)) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || r.status}`);
  return r.stdout;
}

/** Unified diff text of the whole change set, plus the facts shown in the header. */
export function collectDiff(repo: string, base?: string) {
  repo = git(repo, ["rev-parse", "--show-toplevel"]).trim(); // untracked listing is cwd-scoped otherwise
  const ref = base || (spawnSync("git", ["-C", repo, "rev-parse", "--verify", "-q", "origin/main"]).status === 0 ? "origin/main" : "main");
  const mergeBase = git(repo, ["merge-base", ref, "HEAD"]).trim();
  let text = git(repo, ["diff", "--no-color", "--no-ext-diff", "-M", mergeBase]);
  for (const f of git(repo, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)) {
    text += git(repo, ["diff", "--no-color", "--no-index", "--", "/dev/null", f], [0, 1]); // exit 1 = differences
  }
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const head = git(repo, ["rev-parse", "--short", "HEAD"]).trim();
  const dirty = git(repo, ["status", "--porcelain"]).trim().length > 0;
  const log = git(repo, ["log", "--oneline", "--no-decorate", `${mergeBase}..HEAD`]).trim();
  return { ref, mergeBase: mergeBase.slice(0, 9), branch, head, dirty, log, text };
}

/** Split `git diff` output into per-file chunks (header lines stripped by the diff component). */
export function splitDiff(text: string): FileDiff[] {
  const out: FileDiff[] = [];
  let total = 0;
  for (const chunk of text.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "))) {
    const plus = chunk.match(/^\+\+\+ (?:b\/)?(.+)$/m)?.[1];
    const minus = chunk.match(/^--- (?:a\/)?(.+)$/m)?.[1];
    const file = (plus && plus !== "/dev/null" ? plus : minus && minus !== "/dev/null" ? minus : chunk.match(/^diff --git a\/(.+?) b\//)?.[1]) ?? "?";
    const lines = chunk.split("\n");
    const adds = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const dels = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    let skipped: string | undefined;
    if (/^Binary files /m.test(chunk)) skipped = "binary";
    else if (SKIP.test(file)) skipped = "generated/lockfile";
    else if (lines.length > MAX_FILE_LINES) skipped = `${lines.length} diff lines — too large to render`;
    else if (total + chunk.length > MAX_TOTAL_CHARS) skipped = "diff budget exhausted — review locally";
    if (!skipped) total += chunk.length;
    out.push({ file, diff: skipped ? "" : chunk, adds, dels, skipped });
  }
  return out;
}

/** The generated block: header facts + one collapsible diff component per file. */
export function diffBlock(files: FileDiff[], info: { repo: string; ref: string; mergeBase: string; branch: string; head: string; dirty: boolean; log: string }): string {
  const adds = files.reduce((a, f) => a + f.adds, 0), dels = files.reduce((a, f) => a + f.dels, 0);
  const commits = info.log ? info.log.split("\n") : [];
  const rows = files.map((f) => `<tr><td><a href="#f-${slugify(f.file)}"><code>${esc(f.file)}</code></a></td><td>+${f.adds} −${f.dels}</td><td>${f.skipped ? `<span class="chip warn">${esc(f.skipped)}</span>` : ""}</td></tr>`).join("\n");
  const body = files.map((f) => f.skipped
    ? `<details id="f-${slugify(f.file)}"><summary><code>${esc(f.file)}</code> · +${f.adds} −${f.dels} · ${esc(f.skipped)}</summary><p class="small muted">Not rendered.</p></details>`
    : `<details id="f-${slugify(f.file)}" open><summary><code>${esc(f.file)}</code> · +${f.adds} −${f.dels}</summary>\n<script type="application/json" data-component="diff">${jsonForScript({ file: f.file, diff: f.diff })}</script>\n</details>`).join("\n");
  return [
    DIFF_START,
    `<section id="diff">`,
    `<h2>Diff</h2>`,
    `<p class="small"><code>${esc(info.repo)}</code> · <b>${esc(info.branch)}</b> @ <code>${esc(info.head)}</code>${info.dirty ? ' <span class="chip warn">+ uncommitted</span>' : ""} vs <code>${esc(info.ref)}</code> (merge base <code>${esc(info.mergeBase)}</code>) · ${files.length} files · +${adds} −${dels} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p>`,
    commits.length ? `<details><summary>${commits.length} commit${commits.length === 1 ? "" : "s"}</summary><ul>${commits.map((c) => `<li><code>${esc(c)}</code></li>`).join("")}</ul></details>` : "",
    `<table class="data"><thead><tr><th>File</th><th>Lines</th><th></th></tr></thead><tbody>\n${rows}\n</tbody></table>`,
    body,
    `</section>`,
    DIFF_END,
  ].filter(Boolean).join("\n");
}
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Content for a new review: agent-written sections (placeholders `check` rejects until filled) + the generated diff. */
export const reviewSkeleton = (block: string) => `<!-- review (local, pre-PR): the Diff section between kb:diff markers is regenerated by \`artifact review\`; write everything else.
     Severity tones: risk = must fix, warn = should fix, info = nit/context, ok = verified good. -->
<section id="verdict">
  <h2>Verdict</h2>
  <aside class="callout {{ok|warn|risk}}" data-label="Verdict">{{One paragraph: ready for PR / fix first, and why}}</aside>
  <p class="small"><span class="chip risk">must fix</span> <span class="chip warn">should fix</span> <span class="chip info">nit</span> <span class="chip ok">verified</span></p>
</section>

<section id="findings">
  <h2>Findings</h2>
  <article class="card accent-risk">
    <h3><span class="chip risk">must fix</span> {{Finding title}}</h3>
    <p>{{What is wrong, what breaks, how to fix. Reference path:line.}}</p>
  </article>
</section>

<section id="checklist">
  <h2>Checklist</h2>
  <table class="data"><thead><tr><th>Check</th><th>Status</th><th>Evidence</th></tr></thead>
  <tbody><tr><td>{{Tests cover the change}}</td><td><span class="chip ok">yes</span></td><td>{{command / output}}</td></tr></tbody></table>
</section>

${block}`;

/** Replace the generated block in existing content (append if the markers are missing). */
export function replaceBlock(content: string, block: string): string {
  const i = content.indexOf(DIFF_START), j = content.indexOf(DIFF_END);
  return i >= 0 && j > i ? content.slice(0, i) + block + content.slice(j + DIFF_END.length) : content + "\n\n" + block;
}
