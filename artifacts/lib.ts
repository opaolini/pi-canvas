/** Pure helpers for html-artifacts: document wrapping, meta parsing, static checks, listing.
 *  No side effects except the small fs readers used by listArtifacts/staticCheck (optional wiki/ backlink scan). */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Bump when runtime/*.css|js change in a way existing artifacts should pick up via `rebuild --all`. */
export const RUNTIME_VERSION = 3;

export type Meta = Record<string, string>;
export type CheckReport = { errors: string[]; warnings: string[] };
export type ArtifactRow = { file: string; slug: string; type: string; date: string; subject: string; size: number; runtime: string; linked: boolean; notes: { total: number; open: number } };

export const META_KEYS = ["type", "slug", "date", "subject", "sources", "question", "runtime"] as const;
const REQUIRED_NON_EMPTY = ["type", "slug", "date", "runtime"];
export const MAX_BYTES = 400 * 1024;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Artifact root: $ARTIFACT_ROOT, else the nearest ancestor with assets/files/, else the nearest git
 *  repository root, else the starting directory. Artifacts live in <root>/assets/files/. */
export function findRoot(from = process.cwd()): string {
  if (process.env.ARTIFACT_ROOT) return resolve(process.env.ARTIFACT_ROOT);
  let start = resolve(from);
  if (!existsSync(start) || !statSync(start).isDirectory()) start = dirname(start);
  const up = (test: (p: string) => boolean) => {
    for (let p = start; ; p = dirname(p)) { if (test(p)) return p; if (dirname(p) === p) return null; }
  };
  return up((p) => existsSync(join(p, "assets/files"))) ?? up((p) => existsSync(join(p, ".git"))) ?? start;
}

export function parseMeta(html: string): Meta {
  const meta: Meta = {};
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 20000); // only the head: runtime JS may contain "<title>" strings
  for (const m of head.matchAll(/<meta\s+name=["']kb:([^"']+)["']\s+content=["']([^"']*)["'][^>]*>/gi)) meta[m[1]] = m[2];
  const title = head.match(/<title>([\s\S]*?)<\/title>/i);
  if (title) meta.title = title[1];
  const theme = head.match(/<html[^>]*data-theme=["']([^"']+)["']/i);
  if (theme) meta.theme = theme[1];
  return meta;
}

export function extractContent(html: string): string | null {
  const m = html.match(/<!-- kb:content:start -->\n([\s\S]*?)\n<!-- kb:content:end -->/);
  return m ? m[1] : null;
}

/** Full document = meta + inlined runtime + content between markers. */
export function wrap(content: string, meta: Meta, runtime: { css: string; js: string }): string {
  const m: Meta = { ...meta, runtime: String(RUNTIME_VERSION) };
  const title = m.title || m.slug || "Artifact";
  const tags = META_KEYS.map((k) => `<meta name="kb:${k}" content="${esc(m[k] ?? "")}">`).join("\n");
  return [
    "<!doctype html>",
    `<html lang="en" data-theme="${m.theme === "dark" ? "dark" : "light"}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    tags,
    "<!-- kb:runtime:start -->",
    `<style>\n${runtime.css}\n</style>`,
    "<!-- kb:runtime:end -->",
    "</head>",
    "<body>",
    `<main id="kb-content" class="${esc(m.type ?? "blank")}">`,
    "<!-- kb:content:start -->",
    content,
    "<!-- kb:content:end -->",
    "</main>",
    "<!-- kb:script:start -->",
    `<script>\n${runtime.js}\n</script>`,
    "<!-- kb:script:end -->",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Does any .md under <root>/wiki/ mention this filename? (Optional convention: false when there is no wiki/.) */
export function linkedFromWiki(root: string, filename: string): boolean {
  const walk = (dir: string): boolean =>
    existsSync(dir) &&
    readdirSync(dir, { withFileTypes: true }).some((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") && readFileSync(join(dir, e.name), "utf8").includes(filename),
    );
  return walk(join(root, "wiki"));
}

export function staticCheck(html: string, root?: string, file?: string): CheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = parseMeta(html);

  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) errors.push("external dependency: <script src>");
  if (/<link\b[^>]*\bhref\s*=\s*["']?https?:/i.test(html)) errors.push("external dependency: <link href=http>");
  if (/@import\b|url\(\s*["']?https?:/i.test(html)) errors.push("external dependency: css @import/url(http)");
  if (/<img\b[^>]*\bsrc\s*=\s*["']https?:/i.test(html)) errors.push("external dependency: <img src=http>");
  if (/<iframe\b/i.test(html)) errors.push("external dependency: <iframe>");

  for (const k of META_KEYS) if (!(k in m)) errors.push(`missing kb:${k}`);
  for (const k of REQUIRED_NON_EMPTY) if (k in m && !m[k]) errors.push(`empty kb:${k}`);
  if (!m.title) errors.push("missing <title>");
  if (/<!--\s*kb:content\s*-->/.test(html)) errors.push("content placeholder <!-- kb:content --> still present");
  // A generated code diff can legitimately contain {{…}} (e.g. GitHub Actions ${{…}}).
  // Validate only agent-authored content; `artifact review` owns the diff block.
  const authored = html.replace(/<!-- kb:diff:start -->[\s\S]*?<!-- kb:diff:end -->/g, "");
  if (/{{[^}]+}}/.test(authored)) errors.push("template placeholder {{…}} still present");
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_BYTES) errors.push(`size ${(bytes / 1024).toFixed(0)} KB exceeds ${MAX_BYTES / 1024} KB`);
  if (m.runtime && m.runtime !== "legacy" && Number(m.runtime) < RUNTIME_VERSION) errors.push(`runtime v${m.runtime} older than v${RUNTIME_VERSION}; run rebuild`);

  if (!/<h2\b/i.test(html)) warnings.push("no <h2> (nothing for the TOC)");
  if ("sources" in m && !m.sources) warnings.push("kb:sources empty");
  if (root && file && existsSync(join(root, "wiki")) && !linkedFromWiki(root, basename(file))) warnings.push("not linked from wiki/");
  return { errors, warnings };
}

export function listArtifacts(root: string): ArtifactRow[] {
  const dir = join(root, "assets/files");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".html"))
    .sort()
    .map((name) => {
      const file = join(dir, name);
      const m = parseMeta(readFileSync(file, "utf8"));
      return {
        file,
        slug: m.slug || name.replace(/\.html$/, ""),
        type: m.type || "unknown",
        date: m.date || "",
        subject: m.subject || "",
        size: statSync(file).size,
        runtime: m.runtime || "none",
        linked: linkedFromWiki(root, name),
        notes: countNotes(file.replace(/\.html$/, ".notes.json")),
      };
    });
}

function countNotes(sidecar: string): { total: number; open: number } {
  if (!existsSync(sidecar)) return { total: 0, open: 0 };
  try { const n = JSON.parse(readFileSync(sidecar, "utf8")).notes ?? []; return { total: n.length, open: n.filter((x: any) => x.status === "open" || x.status === "sent").length }; } catch { return { total: 0, open: 0 }; }
}

/** Insert (or replace) kb:* meta tags in a legacy document's head without touching its body. */
export function backfillHtml(html: string, values: Meta): string {
  const tags = META_KEYS.map((k) => `<meta name="kb:${k}" content="${esc(k === "runtime" ? "legacy" : values[k] ?? "")}">`).join("\n");
  const stripped = html.replace(/[ \t]*<meta\s+name=["']kb:[^>]*>\s*\n?/gi, "");
  if (!/<\/head>/i.test(stripped)) throw new Error("no </head> in document");
  return stripped.replace(/<\/head>/i, `${tags}\n</head>`);
}
