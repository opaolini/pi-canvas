---
name: html-artifact
description: Produce a self-contained, interactive HTML artifact (explainer, visualization, code review, options comparison, plan, report, deck, triage board, dashboard) with the pi-canvas `artifact` CLI. Use when the user says "explain this better", "visualize this", "draft a report", "lay out the options", "help me review this", "make a deck / board", or when diagrams, comparisons, annotated code or interactive content would help understanding. The agent writes content; the tool owns all CSS/JS, verification and upgrades.
---

# html-artifact — build blocks, not pages

One file, no network, no hand-written CSS/JS. You write the **content of `<main>`** from a fixed
component vocabulary; the `artifact` CLI wraps it in the runtime, checks it, screenshots it, and can
re-inject a newer runtime into every existing artifact later.

`A=../../artifacts/artifact` (relative to this skill directory; resolve to an absolute path). Needs Bun.
Artifacts go to `<root>/assets/files/` where root = `$ARTIFACT_ROOT`, else the nearest ancestor with
`assets/files/`, else the git repository root, else the current directory.

Token budget rule: **never read or rewrite the whole artifact file.** Create with `new`, fill the
placeholder with one edit, verify with `check`. Read `$A components` instead of templates or runtime source.

## When HTML instead of Markdown

| Signal | → |
|---|---|
| Needs a diagram, comparison grid, timeline, chart, or annotated code | artifact |
| Read once to *understand*, or shared with others | artifact |
| Two-way: reorder / bucket / approve things and hand the result back | artifact `board` |
| Durable reference doc | Markdown (link the artifact from it) |
| Short answer, a number, a lookup | plain reply |

## Loop

```
$A types                      # which type fits
$A components                 # the component cheat sheet — all you need to read
$A new <type> <slug> --title "…" --subject a,b --question "…" --sources <urls>
#   → assets/files/<slug>-<date>.html ; prints the skeleton it wrote
edit  … replace the placeholders inside <!-- kb:content:start --> … <!-- kb:content:end -->
$A check <slug>               # static checks + headless Chrome; screenshot → assets/images/artifacts/
$A open <slug>
```

1. **Gather facts first.** The artifact renders knowledge; it does not replace research. Cite
   inline; mark guesses with `<span class="flag">unverified</span>`.
2. **Pick the type** (`explainer`, `review`, `compare`, `plan`, `report`, `deck`, `board`,
   `dashboard`, `blank`). The template's comment header lists the expected sections.
3. **Write content only.** Semantic HTML + component classes + JSON data components
   (`<script type="application/json" data-component="flow|bars|timeline|kpis|compare|board|steps|diff|sequence|line|tree|matrix">`).
   Diagrams are `flow`/`sequence` JSON or inline SVG — never ASCII, never Mermaid.
   Proposed or reviewed code changes are `diff` components with `"file"` set.
4. **Check, look, fix.** `check` fails on external assets, leftover placeholders, missing meta,
   stale runtime, console errors. Look at the screenshot once and fix anything that reads badly.
5. **Boards return work.** A `board` ends with the user pasting its export back; apply it.

## Interactive review sessions (notes back into pi)

```
$A session <slug> --detach --no-open   # serve on 127.0.0.1 with the annotation layer, in the background
$A session <slug> --url                # link that preselects THIS pi session as the recipient — give the user this
$A session --stop <slug>
```
The user selects text, ⌥-clicks / pins an element (diagram node, card, chart bar, diff line) →
**Question / Note / Change / Approve** → notes persist in `assets/files/<file>.notes.json` →
**Send via Pi** delivers them to this session through pi-intercom (copy-as-prompt/Markdown/JSON works
without it). Notes on `diff` lines carry `path:line`.

**When an "Artifact review" message arrives:**
1. `$A notes <slug>` for the full state.
2. Address each note: answer questions, change the content region or the underlying code.
3. `$A reply <slug> <id> "…"` for every note; `$A resolve <slug> <id>` when done. After content
   edits, `$A rebuild <slug>` — the open page reloads itself.

Pre-PR code review: follow `../local-review/SKILL.md`.

Never edit an artifact while a session is open without `rebuild`.

## Content rules

- Lead with the answer: 3 summary bullets or KPIs above the fold.
- ≤ 4 code snippets, each the lines that matter, annotated.
- One `flow` per mechanism; one `timeline` per history; one `bars` per distribution.
- Tones are consistent: `ok` verified, `warn` caveat, `risk` blocker, `info` context, `muted` out of scope.
- Real names, numbers and links. No invented data; label estimates.
- Dark theme (`--theme dark`) for dashboards only. Aim < 150 KB; aggregate big datasets.

## Gotchas

- `check` needs Chrome; without it the render step is skipped, not failed — say so.
  Long page: `KB_RENDER_SIZE=1280,3600 $A check <slug>`.
- `check` does not rebuild. After runtime changes: bump `RUNTIME_VERSION` in `lib.ts`,
  `$A rebuild --all`, `$A check --all`.
- In `steps[].text` and `timeline[].detail` inline HTML is live — escape literal tags.
- Board state lives in `localStorage` per slug; exports reflect the current board.
- If `<root>/wiki/` exists, `check`/`list` also report whether a `.md` there links the artifact.
