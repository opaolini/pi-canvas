# Components cheat sheet (runtime v2)

You write only what goes between `<!-- kb:content:start -->` and `<!-- kb:content:end -->`.
Header (title/type/date/subjects/question/sources), footer, and TOC (≥3 `<h2>`) are generated from meta.
Tones: `ok` `warn` `risk` `info` `muted` `accent`. Never write `<style>`/`<script>` logic; use these.

## Structure
```html
<section id="x"><h2>Heading</h2> …</section>          <!-- one section per h2; TOC auto -->
<p class="lead">Opening sentence, larger and muted.</p>
<div class="grid cols-3"> <article class="card accent-ok"><h3>Title</h3><p>…</p></article> … </div>
<aside class="callout gotcha">Surprising fact.</aside>   <!-- note | ok | warn | risk | gotcha; data-label="Custom" -->
<span class="chip risk">must fix</span>  <span class="flag">unverified</span>  <span class="muted small">aside</span>
<details><summary>Question?</summary><p>Answer</p></details>   <!-- wrap several in <div class="details-group"> -->
<div class="two-col">…prose split in two columns…</div>   <div class="page-break"></div>
<figure>…svg or img (../images/x.png)…<figcaption>Caption</figcaption></figure>
```
Disable TOC: `<main data-toc="off">` is not editable — instead keep < 3 `<h2>`.

## Tabs (alternatives, per-language samples)
```html
<div class="tabs">
  <div class="tab" data-title="Option A">…</div>
  <div class="tab" data-title="Option B">…</div>
</div>
```

## Code
```html
<pre><code>plain block — copy button is automatic</code></pre>
<div class="code" data-file="src/gateway/auth.ts">          <!-- filename label -->
  <div class="annotated">
<pre><code>line 1
line 2
line 3
</code></pre>
    <ul class="margin">
      <li data-lines="1">Why line 1 matters.</li>
      <li data-lines="2-3">Hover highlights these lines.</li>
    </ul>
  </div>
</div>
<p data-copy>Any element with data-copy gets a Copy button (copies its text).</p>
<div data-copy="#export-md">Copy button that copies another element's text</div>
```
Escape `<` as `&lt;` inside `<code>`. Keep snippets to the lines that matter.

## Tables
```html
<table class="data" data-sortable>
  <thead><tr><th>Name</th><th class="num">Value</th><th>Status</th></tr></thead>
  <tbody><tr><td>x</td><td class="num" data-sort="1200">1.2k</td><td><span class="chip ok">ok</span></td></tr></tbody>
</table>
```

## Data components — `<script type="application/json" data-component="NAME">JSON</script>`
Fewest tokens; rendered and upgraded by the runtime. Invalid JSON renders a red callout and fails `check`.

```html
<script type="application/json" data-component="kpis">
[{"label":"p75 startup","value":"19.9s","sub":"−2.1s vs. last month","tone":"warn"}]
</script>

<script type="application/json" data-component="steps">
[{"title":"Request arrives","text":"Edge terminates TLS…","tone":"info"},{"title":"Policy check"}]
</script>
<!-- steps.text and timeline.detail accept inline HTML (<code>, <a>, <span class="flag">); titles/labels are escaped. -->

<script type="application/json" data-component="timeline">
[{"t":"2026-08-12 14:03","label":"Rate limit tripped","detail":"ticket #1234","tone":"risk"},{"t":"2026-08-12 16:40","label":"Fixed","tone":"ok"}]
</script>

<script type="application/json" data-component="bars">
{"unit":"s","max":60,"items":[{"label":"api","value":19.9,"tone":"warn","note":"p75"},{"label":"web","value":8.2,"tone":"ok"}]}
</script>

<script type="application/json" data-component="flow">
{"direction":"lr","caption":"Request path",
 "nodes":[{"id":"cl","label":"Client"},{"id":"gw","label":"Gateway","sub":"auth + rate limit","tone":"accent"},{"id":"llm","label":"Provider","tone":"ok"},{"id":"dd","label":"Metrics","tone":"muted"}],
 "edges":[{"from":"cl","to":"gw","label":"HTTPS"},{"from":"gw","to":"llm"},{"from":"gw","to":"dd","label":"logs"}]}
</script>
<!-- flow: layers = longest path from sources; back edges loop around; ≤ 15 nodes. Omit "direction" and wide
     chains switch to top-to-bottom automatically; force with "lr" | "tb". -->

<script type="application/json" data-component="compare">
{"options":[
  {"title":"Keep cron host","summary":"…","pros":["known"],"cons":["host upkeep"],"tradeoff":"pay to avoid change","tags":["status quo"],"tone":"warn"},
  {"title":"Managed scheduler","summary":"…","pros":["one platform"],"cons":["migration"],"tradeoff":"weeks of work","tone":"ok"}],
 "criteria":[{"name":"Cost","scores":{"Keep cron host":1,"Managed scheduler":3}},{"name":"Risk","scores":{"Keep cron host":3,"Managed scheduler":2}}]}
</script>
<!-- compare: scores 0–3 render as ✕ ◔ ◑ ●; strings render verbatim. -->

<script type="application/json" data-component="board">
{"columns":["Now","Next","Later","Cut"],"export":"all",
 "cards":[{"id":"T-12","title":"Remove stale fallback data","meta":"me · M","column":"Now","note":"blocks monthly report"}]}
</script>
<!-- board: drag between columns, per-card rationale, Copy as Markdown / JSON / prompt, Reset. State in localStorage per slug.
     Markdown export: "## <column>" then "- **id** title — note". export: "markdown" | "json" | "prompt" | "all" -->
```

## v2 data components

```html
<script type="application/json" data-component="diff">
{"file":"src/gateway/auth.ts","caption":"PR #1120",
 "diff":"@@ -10,3 +10,4 @@\n   const key = req.headers.get(\"x\");\n-  if (!key) return null;\n+  if (!key) throw new Unauthorized();\n+  const cached = cache.get(key);\n",
 "notes":[{"match":"throw new Unauthorized","text":"Behaviour change — callers expecting <code>null</code>.","tone":"risk","label":"must fix"},{"new":13,"text":"No eviction.","tone":"warn"}]}
</script>
<!-- diff: paste a unified diff (hunk headers required; ---/+++ lines optional). notes anchor by "match" substring, "new" or "old" line number; text is inline HTML. Always set "file": in a session or review gate it makes reviewer notes arrive as path:line. Use it in plans for proposed changes, in reviews for findings. -->

<script type="application/json" data-component="sequence">
{"caption":"Rate-limited request","actors":[{"id":"c","label":"Client"},{"id":"gw","label":"Gateway","tone":"accent"},{"id":"p","label":"Provider","tone":"ok"}],
 "steps":[{"from":"c","to":"gw","label":"POST /v1/chat"},{"from":"gw","to":"gw","label":"check limit","note":"100 req/min"},{"from":"gw","to":"p","label":"forward","tone":"ok"},{"from":"p","to":"gw","label":"200","dashed":true},{"from":"gw","to":"c","label":"200","dashed":true}]}
</script>
<!-- sequence: time-ordered messages between actors; from==to draws a self-loop; dashed = reply; optional "gap":"…later…" text under a step. -->

<script type="application/json" data-component="line">
{"unit":"s","caption":"Weekly p75","x":["W27","W28","W29","W30"],
 "series":[{"label":"p50","tone":"ok","values":[9.1,8.8,9.4,8.2]},{"label":"p75","tone":"warn","values":[22,21.4,23.1,19.9]}]}
</script>
<!-- line: values (x = index, labelled by "x") or points [[x,y],…]; "min"/"max" fix the y range; legend shows last values. -->
<td><script type="application/json" data-component="sparkline">{"values":[22,21.4,23.1,19.9],"tone":"warn","unit":"s"}</script></td>
<!-- sparkline: inline 120×28 trend + last value ("showLast":false to hide); fits in table cells and KPI subs. -->

<script type="application/json" data-component="tree">
{"open":2,"nodes":[{"label":"src/","children":[{"label":"gateway/","children":[{"label":"auth.ts","tone":"accent","note":"entry point"}]},{"label":"old.ts","tone":"muted","note":"removed"}]}]}
</script>
<!-- tree: nested {label, note?, tone?, children?}; "open" = depth expanded by default; muted = struck through. -->

<script type="application/json" data-component="matrix">
{"corner":"service × env","rows":["api","worker"],"cols":["staging","production"],
 "cells":{"api":{"staging":"ok","production":{"tone":"warn","label":"deferred","title":"cutover deferred"}},"worker":{"staging":{"tone":"risk","label":"✕","href":"https://example.com/issue/1"},"production":"ok"}},
 "legend":{"ok":"healthy","warn":"caveat","risk":"blocked"}}
</script>
<!-- matrix: cell = tone string (renders ● ◑ ✕ ○ –) or {tone, label, title?, href?}; "cells" may also be an array of rows. -->
```

## Deck (type `deck`)
```html
<section class="slide"><h1>Title</h1><p class="lead">subtitle</p></section>
<section class="slide"><h2>Point</h2><ul><li>…</li></ul></section>
```
← → / space / Home / End; click advances; `?all` or print stacks all slides. No header/TOC on decks.

## Rules of thumb
- Lead with the answer (bullets or `kpis`). ≤ 4 code snippets. One `flow` per mechanism.
- Real links: `<a href="https://github.com/owner/repo/issues/42">#42</a>`. Relative images: `../images/<file>`.
- Anything guessed: `<span class="flag">unverified</span>` or `<span class="flag">estimate</span>`.
- One-off styling: ≤ 20 lines of `<style>` inside the content region, then promote it to the runtime.
