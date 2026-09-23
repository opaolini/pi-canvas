# artifacts — tool contract

Local, zero-runtime-dependency Bun tool that turns agent-written **content** into self-contained,
verified HTML artifacts under `<root>/assets/files/`. The agent never writes CSS/JS chrome; the tool owns
it and can re-inject an upgraded runtime into every existing artifact.

Goal: **minimum tokens per artifact**. The agent (1) runs `artifact new`, (2) replaces one
placeholder comment with content built from the documented components, (3) runs `artifact check`.

## Layout

```
artifacts/
  artifact            # executable shim: #!/usr/bin/env bun → cli.ts
  cli.ts              # arg parsing + commands (thin)
  lib.ts              # pure functions: wrap, extractContent, parseMeta, staticCheck, listArtifacts, findRoot
  render.ts           # headless Chrome runner (spawn, poll screenshot, kill, parse console)
  runtime/tokens.css  # :root light tokens; [data-theme="dark"] overrides
  runtime/base.css    # layout + components (see COMPONENTS.md)
  runtime/runtime.js  # behaviours + data-component renderers; installs error prefixing
  templates/<type>.html   # content skeletons (only what goes inside the content markers)
  types.json          # catalogue: { type: { title, purpose, sections: [..], template } }
  COMPONENTS.md       # agent-facing cheat sheet (printed by `artifact components`)
  SPEC.md             # this file
  cli.test.ts         # bun test — pure functions + CLI smoke (no Chrome required)
```

Root = `$ARTIFACT_ROOT`, else the nearest ancestor of `cwd` containing `assets/files/`, else the
nearest git repository root, else `cwd`. `assets/files/` is created on demand. All paths below are
relative to the root. An optional `wiki/` directory under the root enables the "linked" check.

## Output document shape

```html
<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="kb:type" content="{type}">
<meta name="kb:slug" content="{slug}">
<meta name="kb:date" content="{YYYY-MM-DD}">
<meta name="kb:subject" content="{comma-separated topic names, e.g. auth,billing}">
<meta name="kb:sources" content="{comma-separated URLs or relative paths}">
<meta name="kb:question" content="{the request this artifact answers}">
<meta name="kb:runtime" content="{runtime version, integer}">
<!-- kb:runtime:start -->
<style>/* tokens.css + base.css inlined */</style>
<!-- kb:runtime:end -->
</head>
<body>
<main id="kb-content" class="{type}">
<!-- kb:content:start -->
{content}
<!-- kb:content:end -->
</main>
<!-- kb:script:start -->
<script>/* runtime.js inlined */</script>
<!-- kb:script:end -->
</body>
</html>
```

- The **header** (title, type chip, date; subjects render as plain chips, sources as links, question as a
  subtitle) and the **footer** ("Generated {date} · {slug} · runtime vN · regenerate with
  `artifact rebuild {slug}`") are rendered by `runtime.js` from `<title>` + `kb:*` meta. The agent never
  writes them.
- `rebuild` = parse meta + title + the region between the content markers, then re-emit the whole
  document with the current runtime. Idempotent. Content is byte-preserved.
- Legacy artifacts (the 5 pre-existing files) are never wrapped. `backfill` only inserts `kb:*`
  meta tags into their `<head>` (plus `kb:runtime` = `legacy`).

## Commands (`artifact <cmd>`)

| Command | Behaviour |
|---|---|
| `new <type> <slug> [--title T] [--subject a,b] [--sources s1,s2] [--question Q] [--theme light\|dark] [--date YYYY-MM-DD] [--open]` | Writes `assets/files/<slug>-<date>.html` from `templates/<type>.html`. Refuses to overwrite. Prints the path and the template skeleton (so the agent sees the placeholder structure without reading the file). Unknown type → list valid types, exit 2. |
| `types` | Prints the catalogue from `types.json`: type, purpose, expected sections. |
| `components` | Prints `COMPONENTS.md`. |
| `check <file\|slug>... \| --all [--no-render] [--json]` | Static checks (below) + headless render when Chrome is available and `--no-render` absent. Exit 1 on any failure. Screenshot → `assets/images/artifacts/<basename-without-ext>.png`. |
| `list [--json]` | Every `assets/files/*.html`: slug, type, date, subject, size, runtime (version or `legacy`/`none`), `linked` = basename appears in any `.md` under `<root>/wiki/` (false when there is no `wiki/`). |
| `rebuild <file\|slug>... \| --all` | Re-inject current runtime. Skips legacy/none files with a notice. |
| `backfill <file> --type T [--subject ..] [--sources ..] [--question ..] [--date ..]` | Insert meta tags into a legacy file's `<head>` (idempotent — replaces existing `kb:*` tags). |
| `open <file\|slug>` | `open` the file in the default browser. |

`<file|slug>` resolution: exact path, else `assets/files/<arg>.html`, else unique glob
`assets/files/<arg>-*.html`; ambiguous → list matches, exit 2.

## Review sessions (`session`, `notes`, `reply`, `resolve`)

`session.ts` runs `Bun.serve` on `127.0.0.1:<port|random>` for one artifact:

| Route | Behaviour |
|---|---|
| `GET /` | The artifact HTML with `runtime/annotate.css` + `runtime/annotate.js` injected before `</body>` plus `window.__kbSession = {slug, file, target, version}`. The file on disk is never modified. |
| `GET /version` | mtime of the artifact; the page polls it and reloads (scroll preserved) when it changes. |
| `GET /notes` · `POST /notes` · `PATCH /notes/:id` · `DELETE /notes/:id` · `POST /notes/:id/reply` | Sidecar CRUD: `assets/files/<file>.notes.json` (`notes.ts`). |
| `GET /export?format=markdown\|json\|prompt` | Read-only portable export. `prompt` is a complete paste-ready Codex follow-up with the artifact path, sidecar path, and note IDs. It never changes note status. |
| `GET /peers` · `POST /target` | Live pi sessions from the intercom broker (sorted by activity, same-cwd first); current target. Default target = `--to`, else `PI_INTERCOM_SESSION_ID` (inherited when launched from a pi session), else the most recently active same-cwd session. |
| `POST /send` | Deliver all `open` notes to the target as one intercom message (Markdown body from `notesToMarkdown` + the JSON subset as a snippet attachment); marks them `sent`. |

Note = `{id, kind: question|note|change|approve, text, anchor:{section?, heading?, quote?, selector?, element?, label?, file?, line?, side?: old|new}, created,
status: open|sent|answered|resolved, sentAt?, replies:[{by: agent|reviewer, text, at}]}`.

Annotation layer (`annotate.js`): select text → floating **＋ Note** → popover (kind, text, ⌘↩);
**⌥-click** any element, or `p` / **📌 Pin element** then click, to anchor a note to a whole component
(flow node, card, bar, KPI, code block, table…; anchor = `{selector: css path, element, label}`,
highlighted with an outline / thicker SVG stroke, re-anchored by label if the selector drifts);
`n` = general note; highlights re-anchor by searching the quoted text inside the anchored section
(whitespace-normalised) and wrapping it in `<mark class="kb-anno …">`; right-hand panel lists notes
with status, replies, reply/resolve/delete, an optional Pi target picker, **Send N via Pi**, and local
**Copy Codex follow-up / Markdown / JSON** actions. Copying is read-only and works without Pi intercom;
the Codex prompt names the artifact, sidecar, and every note ID. Polls `/notes` and `/version` every 3 s.
Logs `[kb-annotate] ready`.

Intercom transport: `pi-intercom/broker/client.ts` from `~/.pi/agent/npm/node_modules` (override with
`KB_INTERCOM_CLIENT`), registered as session name `artifact-session`, connected only for the
duration of a `send`/`list` call. Requires a running broker (any live pi session provides one).

`--detach` re-spawns the CLI as a background process; the server writes
`assets/files/.session-<slug>.json` = `{pid, port, file, started}` (gitignored). `session <slug>` on a
running session reuses it and opens/prints `http://127.0.0.1:<port>/?to=<pi session id>` — the `?to=`
query pins the recipient for that tab (shown as 🔗 in the panel; `/send` takes `to` from the client).
`session <slug> --url` prints that link without opening; `session --stop <slug>` kills it.

Diff anchors: the `diff` component sets `data-file` on `.diff` and `data-line`/`data-side` on each row. A
selection or ⌥-click inside a diff adds `{file, line: "N" | "N-M", side}`; such notes highlight rows with a
gutter bar (never wrap text across `<tr>`s) and render as `` `path:line` `` in Markdown/intercom.

## Local pre-PR review (`review`)

`review <slug> [--repo PATH] [--base REF] [--title T] [--date D]` (`review.ts`): base = `--base`, else
`origin/main` if it resolves, else `main`; diff = `git diff -M <merge-base>` (committed + uncommitted tracked)
+ `git diff --no-index /dev/null <f>` for untracked files. One collapsible `diff` component per file,
preceded by a header (branch, head, dirty, merge base, totals), commit list and file table. Lockfiles,
`*.snap`, `*.min.*`, binaries, files > 800 diff lines, and anything past a 220 KB budget are listed but not
rendered. The generated block sits between `<!-- kb:diff:start -->` / `<!-- kb:diff:end -->`. First run
writes `assets/files/<slug>-<date>.html` with Verdict/Findings/Checklist placeholders (so `check` fails
until the agent fills them); later runs on an existing slug replace only that block and rewrap, so
agent content and notes survive and open sessions reload. Procedure: `skills/local-review`.

Component candidates: checklist, gantt, tuner, editor, zoom.

Agent side: `notes <slug> [--format markdown|json|prompt]` exports the sidecar as Markdown, canonical JSON,
or a paste-ready Codex follow-up (`--json` remains an alias); `reply <slug> <id>
"text"` appends an agent reply and sets `answered`; `resolve <slug> <id>` sets `resolved`.

## Static checks (`check`)

Fail (exit 1):
- external dependency: `<script src=` / `<link … href=` / `@import` / `url(http` / `<img src="http`
  (inline `data:` and relative `../images/` are fine),
- missing any `kb:*` meta (`type,slug,date,subject,question,runtime`) or `<title>`,
- content placeholder still present (`<!-- kb:content -->` or `{{`…`}}` tokens from a template); for local reviews, ignore literal `{{`…`}}` in the generated `kb:diff` block (e.g. GitHub Actions source), while still checking agent-authored content,
- size > 400 KB,
- runtime version older than current (message: run `rebuild`).

Warn:
- not linked from `wiki/` (only when `<root>/wiki/` exists),
- no `<h2>` (nothing for the TOC),
- `kb:sources` empty.

## Render check (`check`, when Chrome is found)

Chrome path: `$KB_CHROME`, else `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
else `google-chrome` / `chromium` on `PATH`. Missing → print "render skipped (no Chrome)", not a
failure.

Spawn (`KB_RENDER_SIZE` overrides the window size, e.g. `1280,3600` for long pages):
```
chrome --headless --disable-gpu --no-sandbox --user-data-dir=<tmpdir> --hide-scrollbars
       --window-size=1280,2000 --enable-logging=stderr --v=0
       --screenshot=<png> file://<abs path>
```
**Chrome does not exit on its own on this machine.** Poll for the PNG (every 250 ms, up to 15 s),
then kill the process tree and remove the tmp profile. Timeout without PNG → fail.
Parse stderr: any line containing `Uncaught ` or `[kb-error]` → fail, quoting the line. Everything
else in `CONSOLE` lines is informational.

`runtime.js` must therefore: `window.addEventListener('error', e => console.log('[kb-error] ' +
e.message))` and wrap `console.error` to prefix `[kb-error]`, and log `[kb-ready]` after rendering
components so the checker can assert the runtime ran (missing `[kb-ready]` → fail).

## Runtime behaviours (`runtime.js`, version 1)

All wiring is by class / data attribute; components never require inline JS from the agent.

- **Header/footer** from meta (above). Type chip uses `kb:type`.
- **TOC**: if `main` has ≥ 3 `h2` and not `data-toc="off"`, insert `<nav class="kb-toc">` after
  the header with links to each `h2` (auto-assign ids from text when missing). Sticky on wide
  screens, collapsed `<details>` on narrow.
- **Tabs**: `.tabs > .tab[data-title]` → build a tab bar; first active; keyboard ← →.
- **Copy**: elements with `data-copy` get a "Copy" button. `data-copy=""` copies the element's own
  `textContent`; `data-copy="#id"` copies that element's text. `pre > code` blocks get a copy button
  automatically. `.code[data-file]` shows the filename label.
- **Annotated code**: `.annotated` containing `pre > code` and `ul.margin > li[data-lines="4-6"]`:
  split code into numbered lines; hovering/focusing a note highlights its lines and vice-versa.
- **Sortable tables**: `table.data[data-sortable]` — click header to sort (numeric-aware).
- **Deck**: `main.deck > section.slide` — one slide at a time, ← → / space / Home / End, counter
  bottom-right, `?all` in the URL or print shows all slides stacked.
- **Data components**: `<script type="application/json" data-component="X">…</script>` is replaced
  by rendered DOM. Invalid JSON → render a `.callout.risk` with the parse error and log
  `[kb-error]`. Components:
  - `kpis`: `[{label, value, sub?, tone?}]` → KPI cards.
  - `timeline`: `[{t, label, detail?, tone?}]` → vertical colored timeline. `detail` is inline HTML.
  - `bars`: `{unit?, max?, items:[{label, value, tone?, note?}]}` → horizontal bar chart, inline
    SVG, values labeled.
  - `flow`: `{nodes:[{id, label, sub?, tone?}], edges:[{from, to, label?}], direction?: "lr"|"tb"}`
    → boxes and arrows as inline SVG. Layout: DFS marks back edges (cycles), then layer nodes by
    longest path from sources over the remaining DAG; layers left→right (or top→bottom); cubic
    arrows with arrowheads, back edges loop around the outside. When `direction` is omitted and
    the lr layout is wider than ~1.15× the content width, the component re-lays out as tb. Good
    enough for ≤ 15 nodes; no crossing minimisation.
  - `compare`: `{options:[{title, summary, tradeoff, pros?:[], cons?:[], tags?:[], tone?}],
    criteria?:[{name, scores:{optionTitle: 0-3 | string}}]}` → grid of option cards + optional
    criteria matrix table.
  - `board`: `{columns:[..], cards:[{id, title, meta?, column, note?}], export?: "markdown"|"json"|"prompt"|"all"}`
    → drag-and-drop columns, per-card editable rationale, buttons **Copy as Markdown / JSON /
    prompt** (`all` default). Markdown export: `## <column>` then `- **id** title — note`. State
    persists in `localStorage` keyed by `kb:slug`; a "Reset" button clears it.
  - `steps`: `[{title, text?, tone?}]` → numbered vertical steps with connectors. `text` is inline HTML.
  - `diff` (v2): `{file?, diff: unified diff text, notes?: [{match?|new?|old?, text, tone?, label?}], caption?}` →
    table of hunks with old/new line numbers, +/− coloring, note rows (callouts) under anchored lines.
  - `sequence` (v2): `{actors:[{id,label,tone?}], steps:[{from,to,label?,note?,tone?,dashed?,gap?}], caption?}` →
    SVG sequence diagram; self-messages loop; dashed for replies.
  - `line` (v2): `{unit?, min?, max?, x?: labels[], series:[{label,tone?,values[]|points[[x,y]]}], caption?}` →
    SVG line chart with grid, ticks, dots, legend with last values. `sparkline`: `{values, tone?, unit?, showLast?}` → inline 120×28.
  - `tree` (v2): `{open?: depth, nodes:[{label, note?, tone?, children?}]}` → nested `<details>` with connectors.
  - `matrix` (v2): `{corner?, rows[], cols[], cells: {row:{col: tone|{tone,label,title?,href?}}} | [[…]], legend?: {tone: text}, caption?}` → toned grid.

Tones everywhere: `ok | warn | risk | info | muted` (map to tokens).

## CSS (`base.css`) — agent-facing classes

Documented in `COMPONENTS.md` with one minimal example each. Must include: `.grid.cols-2|3|4`,
`.card` (+ `.accent-{tone}`), `.callout.{note|warn|risk|ok|gotcha}`, `.chip.{tone}`, `.kpis/.kpi`,
`.tabs/.tab`, `details/summary` styling, `.code[data-file]`, `.annotated`, `table.data`,
`ol.steps`, `.flag` (inline "unverified"/"estimate" marker), `.page-break`, `.muted`, `.small`,
`figure/figcaption`, `.two-col` prose split, headings/prose rhythm, responsive ≤ 720 px,
`@media print` (expand `details`, show all tabs stacked with their titles, hide TOC/buttons,
page-break support, black-on-white).

Fonts: system stack only. No external assets. Dark theme via `[data-theme="dark"]` token
overrides only (no separate rules in base.css beyond tokens).

## Tokens (`tokens.css`)

Light (default) extracted from the existing violet artifacts:
`--ink:#17152b --muted:#66627a --paper:#fff --canvas:#f5f3fb --line:#e6e1f1 --accent:#6f4bf2
--accent-deep:#342171 --accent-soft:#eee9ff --ok:#138a5b --warn:#b86b00 --risk:#bc3d4b
--info:#2d6cdf --cyan:#14b8c4 --shadow:0 12px 32px rgba(23,21,43,.08) --radius:12px`.
Dark (from the Oz dashboard): `--paper:#101720 --canvas:#090d12 --ink:#edf3fa --muted:#8c9bad
--line:#263241 --accent:#74a7ff --ok:#68d391 --warn:#f6c85f --risk:#ff7b72 --info:#66d9ef`.
Also `--font-sans`, `--font-mono`, `--max-w:1100px`.

## Templates (`templates/<type>.html`)

Content-only skeletons. Each begins with an HTML comment (≤ 8 lines) telling the agent what the
sections are for, then sections with `<!-- kb:content -->`-style placeholders and one realistic
example of the components that type usually needs (kept tiny). Types (from `types.json`):

| type | sections |
|---|---|
| `explainer` | Summary (3 bullets) · How it works (flow + steps) · Key code (annotated ×2–4) · Gotchas (callouts) · FAQ (details) · Sources |
| `review` | Verdict + severity legend · Change map (flow) · Findings (cards by severity, each with annotated snippet) · Questions for author · Checklist |
| `compare` | Question · Options (compare component) · Recommendation (callout) · What would change my mind |
| `plan` | Goal · Waves (flow) · Work items (table.data) · Risks (callouts) · Open decisions |
| `report` | KPIs · What happened (timeline) · Evidence (table/bars) · Decisions & follow-ups · Appendix (details) |
| `deck` | 6 slides: title, context, 3 content, next steps |
| `board` | Instructions · board component pre-filled with 4 example cards · what to do with the export |
| `dashboard` | dark theme by default · KPIs · bars · sortable table · notes |
| `blank` | just the markers |

## Tests (`cli.test.ts`, `bun test`, no Chrome)

- `wrap()` produces the document shape; `extractContent(wrap(x)) === x`; rebuild is idempotent.
- `new` for every type writes a file that passes `staticCheck` **except** for the intentional
  placeholder failure; a filled fixture passes fully.
- `staticCheck` catches each fail condition (external script, missing meta, oversize, stale runtime).
- `list` reports type/date/linked correctly against a temp root fixture (`wiki/x.md` referencing
  one file).
- `backfill` inserts/replaces meta tags in a legacy fixture without touching its body.

## Change log

- v1 (2026-09-02) — initial runtime.
- v3 (2026-09-02) — `flow`: word-wrapped label/sub with node size following the text; edge labels get a canvas-colored halo (also in `sequence`).
- v2 (2026-09-02) — `diff`, `sequence`, `line`/`sparkline`, `tree`, `matrix`; `review` template uses `diff`. `rebuild --all` applied.
- 2026-09-02 — review sessions (`session`/`notes`/`reply`/`resolve`) with pi-intercom delivery; annotation layer is session-only, not part of the runtime version.

## Non-goals (v1)

No Markdown parser, no Mermaid, no bundler, no hosting, no network beyond 127.0.0.1 and the local
intercom socket.

Detached sessions use a separate process group with closed stdio and report success only after their
own PID registers a ready session. This allows the server to survive native harness command cleanup.
Run without `--detach` to inspect startup errors.
