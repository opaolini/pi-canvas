/* html-artifacts runtime v3.
   Renders header/footer from <meta name="kb:*">, wires behaviours by class/data attribute, and
   expands <script type="application/json" data-component="..."> blocks into DOM. No network, no
   dependencies. Errors are prefixed "[kb-error]" so `artifact check` can fail on them; "[kb-ready]"
   is logged once everything rendered. */
(function () {
  "use strict";

  // ---------- error reporting contract ----------
  var origError = console.error.bind(console);
  console.error = function () { origError.apply(null, ["[kb-error]"].concat([].slice.call(arguments))); };
  window.addEventListener("error", function (e) { console.log("[kb-error] " + (e.message || e)); });

  var main = document.getElementById("kb-content") || document.body;
  var meta = function (k) { var m = document.querySelector('meta[name="kb:' + k + '"]'); return m ? m.getAttribute("content") || "" : ""; };
  var el = function (tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tone = function (t) { return /^(ok|warn|risk|info|muted|accent)$/.test(t || "") ? t : ""; };
  var slug = meta("slug") || location.pathname.split("/").pop();
  var copyText = function (text, btn) {
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = t; }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else { var ta = el("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
  };

  // ---------- header / footer ----------
  function renderHeader() {
    var title = document.title || slug;
    var sources = meta("sources").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var subjects = meta("subject").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var h = el("header", "kb-header");
    var inner = el("div", "kb-inner");
    var kicker = el("div", "kb-kicker");
    kicker.appendChild(el("span", "chip accent", esc(meta("type") || "artifact")));
    if (meta("date")) kicker.appendChild(el("span", "", esc(meta("date"))));
    subjects.forEach(function (s) { kicker.appendChild(el("span", "chip", esc(s))); });
    inner.appendChild(kicker);
    inner.appendChild(el("h1", "", esc(title)));
    if (meta("question")) inner.appendChild(el("p", "kb-question", esc(meta("question"))));
    if (sources.length) {
      var src = el("div", "kb-sources", "<b>Sources:</b> ");
      sources.forEach(function (s) {
        var a = el("a", "", esc(s.replace(/^https?:\/\//, "").slice(0, 80)));
        a.href = s; a.target = "_blank"; a.rel = "noopener"; src.appendChild(a);
      });
      inner.appendChild(src);
    }
    h.appendChild(inner);
    main.insertBefore(h, main.firstChild);
    var f = el("footer", "kb-footer", "Generated " + esc(meta("date")) + " · <code>" + esc(slug) + "</code> · runtime v" + esc(meta("runtime")) + " · regenerate with <code>artifact rebuild " + esc(slug) + "</code>");
    main.appendChild(f);
  }

  // ---------- table of contents ----------
  function renderToc() {
    if (main.getAttribute("data-toc") === "off" || main.classList.contains("deck")) return;
    var hs = [].slice.call(main.querySelectorAll("h2"));
    if (hs.length < 3) return;
    var used = {};
    var toc = el("details", "kb-toc"); toc.open = window.innerWidth >= 1360;
    toc.appendChild(el("summary", "", "Contents"));
    var ol = el("ol");
    hs.forEach(function (h) {
      if (!h.id) { var id = h.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section"; while (used[id] || document.getElementById(id)) id += "-x"; h.id = id; }
      used[h.id] = 1;
      var li = el("li"); var a = el("a", "", esc(h.textContent)); a.href = "#" + h.id; li.appendChild(a); ol.appendChild(li);
    });
    toc.appendChild(ol);
    var header = main.querySelector(".kb-header");
    main.insertBefore(toc, header ? header.nextSibling : main.firstChild);
  }

  // ---------- tabs ----------
  function wireTabs() {
    [].forEach.call(main.querySelectorAll(".tabs"), function (box) {
      var tabs = [].filter.call(box.children, function (c) { return c.classList.contains("tab"); });
      if (!tabs.length) return;
      var bar = el("div", "tabbar"); bar.setAttribute("role", "tablist");
      tabs.forEach(function (t, i) {
        var title = t.getAttribute("data-title") || "Tab " + (i + 1);
        t.insertBefore(el("div", "tab-title", esc(title)), t.firstChild);
        var b = el("button", "", esc(title)); b.setAttribute("role", "tab");
        b.onclick = function () { select(i); };
        bar.appendChild(b);
      });
      function select(i) {
        tabs.forEach(function (t, j) { t.classList.toggle("active", i === j); bar.children[j].setAttribute("aria-selected", i === j ? "true" : "false"); });
      }
      bar.addEventListener("keydown", function (e) {
        var cur = [].findIndex.call(bar.children, function (b) { return b.getAttribute("aria-selected") === "true"; });
        if (e.key === "ArrowRight") { select((cur + 1) % tabs.length); bar.children[(cur + 1) % tabs.length].focus(); }
        if (e.key === "ArrowLeft") { select((cur - 1 + tabs.length) % tabs.length); bar.children[(cur - 1 + tabs.length) % tabs.length].focus(); }
      });
      box.insertBefore(bar, box.firstChild);
      select(0);
    });
  }

  // ---------- copy buttons ----------
  function wireCopy() {
    [].forEach.call(main.querySelectorAll("pre > code"), function (code) {
      var pre = code.parentElement; if (pre.querySelector(".copy")) return;
      var b = el("button", "copy", "Copy"); b.onclick = function () { copyText(code.textContent, b); }; pre.appendChild(b);
    });
    [].forEach.call(main.querySelectorAll("[data-copy]"), function (node) {
      var b = el("button", "copy", "Copy");
      b.onclick = function () {
        var sel = node.getAttribute("data-copy"); var src = sel ? document.querySelector(sel) : node;
        copyText(src ? src.textContent.trim() : "", b);
      };
      node.appendChild(b);
    });
  }

  // ---------- annotated code ----------
  function wireAnnotated() {
    [].forEach.call(main.querySelectorAll(".annotated"), function (box) {
      var code = box.querySelector("pre > code"); if (!code) return;
      var lines = code.textContent.replace(/\n$/, "").split("\n");
      code.innerHTML = lines.map(function (l, i) { return '<span class="ln" data-n="' + (i + 1) + '">' + esc(l) + "\n</span>"; }).join("");
      var spans = code.querySelectorAll(".ln");
      var range = function (spec) { var out = []; String(spec).split(",").forEach(function (p) { var m = p.trim().match(/^(\d+)(?:-(\d+))?$/); if (!m) return; for (var i = +m[1]; i <= +(m[2] || m[1]); i++) out.push(i); }); return out; };
      var notes = [].slice.call(box.querySelectorAll("ul.margin > li"));
      var hi = function (note, on) { note.classList.toggle("hi", on); range(note.getAttribute("data-lines")).forEach(function (n) { if (spans[n - 1]) spans[n - 1].classList.toggle("hi", on); }); };
      notes.forEach(function (note) {
        note.tabIndex = 0;
        note.addEventListener("mouseenter", function () { hi(note, true); }); note.addEventListener("mouseleave", function () { hi(note, false); });
        note.addEventListener("focus", function () { hi(note, true); }); note.addEventListener("blur", function () { hi(note, false); });
      });
      spans.forEach(function (s, i) {
        s.addEventListener("mouseenter", function () { notes.forEach(function (n) { if (range(n.getAttribute("data-lines")).indexOf(i + 1) >= 0) hi(n, true); }); });
        s.addEventListener("mouseleave", function () { notes.forEach(function (n) { hi(n, false); }); });
      });
    });
  }

  // ---------- sortable tables ----------
  function wireSortable() {
    [].forEach.call(main.querySelectorAll("table.data[data-sortable]"), function (table) {
      var ths = table.querySelectorAll("thead th"); var tbody = table.tBodies[0]; if (!tbody) return;
      ths.forEach(function (th, idx) {
        th.addEventListener("click", function () {
          var dir = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
          ths.forEach(function (t) { t.removeAttribute("aria-sort"); }); th.setAttribute("aria-sort", dir);
          var rows = [].slice.call(tbody.rows);
          var val = function (r) { var c = r.cells[idx]; var t = c ? (c.getAttribute("data-sort") || c.textContent).trim() : ""; var n = parseFloat(t.replace(/[^0-9.\-]/g, "")); return isNaN(n) || !/^[\s$€£]*-?[\d.,]+/.test(t) ? t.toLowerCase() : n; };
          rows.sort(function (a, b) { var x = val(a), y = val(b); var r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)); return dir === "ascending" ? r : -r; });
          rows.forEach(function (r) { tbody.appendChild(r); });
        });
      });
    });
  }

  // ---------- deck ----------
  function wireDeck() {
    if (!main.classList.contains("deck")) return;
    var slides = [].slice.call(main.querySelectorAll(":scope > section.slide")); if (!slides.length) return;
    var all = /[?&]all\b/.test(location.search) || window.matchMedia("print").matches;
    var counter = el("div", "deck-counter"); main.appendChild(counter);
    var i = Math.max(0, Math.min(slides.length - 1, parseInt((location.hash || "#1").slice(1), 10) - 1 || 0));
    function show(n) { i = (n + slides.length) % slides.length; slides.forEach(function (s, j) { s.classList.toggle("active", j === i); }); counter.textContent = (i + 1) + " / " + slides.length; history.replaceState(null, "", "#" + (i + 1)); }
    if (all) { main.classList.add("all"); return; }
    show(i);
    // Annotation UI and form fields own the keyboard; the deck only navigates when nothing else wants the key.
    function annotating(t) { var pop = document.getElementById("kb-pop"); return (pop && pop.style.display === "block") || (t && t.closest && t.closest("textarea,input,select,[contenteditable],#kb-pop,#kb-panel")); }
    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || annotating(e.target)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); show(i + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
      else if (e.key === "Home") show(0); else if (e.key === "End") show(slides.length - 1);
    });
    main.addEventListener("click", function (e) { if (e.altKey || annotating(e.target) || !window.getSelection().isCollapsed || document.body.classList.contains("kb-pin-mode") || e.target.closest("a,button,textarea,input,details,summary,mark.kb-anno,.kb-anno-box")) return; show(i + 1); });
    window.addEventListener("beforeprint", function () { main.classList.add("all"); });
    window.addEventListener("afterprint", function () { main.classList.remove("all"); show(i); });
  }

  // ---------- data components ----------
  var components = {};

  components.kpis = function (d) {
    var box = el("div", "kpis");
    d.forEach(function (x) { box.appendChild(el("div", "kpi " + tone(x.tone), "<b>" + esc(x.value) + "</b><span>" + esc(x.label) + "</span>" + (x.sub ? "<small>" + esc(x.sub) + "</small>" : ""))); });
    return box;
  };

  components.timeline = function (d) {
    var box = el("div", "timeline");
    d.forEach(function (x) { box.appendChild(el("div", "tl " + tone(x.tone), "<time>" + esc(x.t) + "</time><b>" + esc(x.label) + "</b>" + (x.detail ? "<p>" + x.detail + "</p>" : ""))); }); // detail: inline HTML allowed
    return box;
  };

  components.steps = function (d) {
    var ol = el("ol", "steps");
    d.forEach(function (x) { ol.appendChild(el("li", tone(x.tone), "<b>" + esc(x.title) + "</b>" + (x.text || ""))); }); // text: inline HTML allowed
    return ol;
  };

  components.bars = function (d) {
    var items = d.items || [];
    var max = d.max || Math.max.apply(null, items.map(function (x) { return +x.value || 0; }).concat([0.000001]));
    var box = el("div", "bars");
    items.forEach(function (x) {
      var pct = Math.max(0, Math.min(100, 100 * (+x.value || 0) / max));
      box.appendChild(el("div", "bar " + tone(x.tone), "<span title=\"" + esc(x.label) + "\">" + esc(x.label) + "</span><i style=\"width:" + pct.toFixed(1) + "%\"></i><b>" + esc(x.value) + esc(d.unit || "") + "</b>" + (x.note ? "<small>" + esc(x.note) + "</small>" : "")));
    });
    return box;
  };

  // Boxes-and-arrows flowchart. Layers = longest path from a source node; layers laid out lr or tb.
  components.flow = function (d, _retryTb) {
    var nodes = d.nodes || [], edges = d.edges || [], tb = d.direction === "tb" || _retryTb === true;
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; n._in = []; n._out = []; });
    // Detect back edges with a DFS so cycles do not break the layering; back edges are drawn as loops.
    var state = {}, backEdge = {};
    edges.forEach(function (e, i) { if (byId[e.from] && byId[e.to]) byId[e.from]._out.push({ to: e.to, i: i }); });
    function dfs(id) { state[id] = 1; byId[id]._out.forEach(function (o) { if (state[o.to] === 1) backEdge[o.i] = true; else if (!state[o.to]) dfs(o.to); }); state[id] = 2; }
    nodes.forEach(function (n) { if (!state[n.id]) dfs(n.id); });
    edges.forEach(function (e, i) { if (!backEdge[i] && byId[e.from] && byId[e.to]) byId[e.to]._in.push(e.from); });
    var layer = {};
    var depth = function (id) { if (layer[id] != null) return layer[id]; var n = byId[id]; var dd = n._in.length ? Math.max.apply(null, n._in.map(function (p) { return depth(p) + 1; })) : 0; layer[id] = dd; return dd; };
    nodes.forEach(function (n) { depth(n.id); });
    var cols = []; nodes.forEach(function (n) { (cols[layer[n.id]] = cols[layer[n.id]] || []).push(n); });
    cols = cols.filter(Boolean);
    // word-wrap label (≤ 26 chars/line, bold 13px) and sub (≤ 34 chars/line, 11.5px); node size follows the wrapped text
    var wrapText = function (str, max) { var words = String(str || "").split(/\s+/), lines = [], cur = ""; words.forEach(function (w) { if (cur && (cur + " " + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }); if (cur) lines.push(cur); return lines; };
    nodes.forEach(function (n) { n._label = wrapText(n.label, 26); n._sub = n.sub ? wrapText(n.sub, 34) : []; });
    var longest = function (lines, px) { return Math.max.apply(null, lines.map(function (l) { return l.length * px; }).concat([0])); };
    var W = function (n) { return Math.max(120, Math.min(250, Math.max(longest(n._label, 7.6), longest(n._sub, 6.3)) + 28)); };
    var H = function (n) { return 12 + n._label.length * 17 + n._sub.length * 14 + (n._sub.length ? 10 : 8); };
    var gapMain = tb ? 44 : 70, gapCross = 18, pad = 12;
    var hasBack = Object.keys(backEdge).length > 0;
    var pos = {};
    var colSizes = cols.map(function (c) { return c.reduce(function (a, n) { return a + (tb ? W(n) : H(n)); }, 0) + gapCross * (c.length - 1); });
    var crossMax = Math.max.apply(null, colSizes);
    var mainOff = pad;
    cols.forEach(function (c, ci) {
      var thick = Math.max.apply(null, c.map(function (n) { return tb ? H(n) : W(n); }));
      var crossOff = pad + (crossMax - colSizes[ci]) / 2;
      c.forEach(function (n) {
        var w = W(n), h = H(n);
        if (tb) { pos[n.id] = { x: crossOff, y: mainOff, w: w, h: h }; crossOff += w + gapCross; }
        else { pos[n.id] = { x: mainOff, y: crossOff, w: w, h: h }; crossOff += h + gapCross; }
      });
      mainOff += thick + gapMain;
    });
    var totalMain = mainOff - gapMain + pad, totalCross = crossMax + pad * 2;
    var width = (tb ? totalCross : totalMain) + (hasBack && tb ? 150 : 0), height = (tb ? totalMain : totalCross) + (hasBack && !tb ? 50 : 0);
    var avail = Math.max(600, main.clientWidth - 56);
    if (!tb && !d.direction && width > avail * 1.15) return components.flow(d, true); // too wide to read: lay out top-to-bottom
    var s = '<svg viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '" role="img"><defs><marker id="kb-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z"/></marker></defs>';
    edges.forEach(function (e, ei) {
      var a = pos[e.from], b = pos[e.to]; if (!a || !b) return;
      var x1, y1, x2, y2, path;
      if (tb) { x1 = a.x + a.w / 2; y1 = a.y + a.h; x2 = b.x + b.w / 2; y2 = b.y; }
      else { x1 = a.x + a.w; y1 = a.y + a.h / 2; x2 = b.x; y2 = b.y + b.h / 2; }
      var forward = !backEdge[ei] && (tb ? y2 > y1 : x2 > x1);
      if (forward) {
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        path = tb ? "M" + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + my + " " + x2 + "," + y2
                  : "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2;
      } else { // back edge: loop around the outside
        var bx1 = tb ? a.x + a.w : a.x + a.w / 2, by1 = tb ? a.y + a.h / 2 : a.y + a.h, bx2 = tb ? b.x + b.w : b.x + b.w / 2, by2 = tb ? b.y + b.h / 2 : b.y + b.h;
        var off = 40;
        path = tb ? "M" + bx1 + "," + by1 + " C" + (bx1 + off) + "," + by1 + " " + (bx2 + off) + "," + by2 + " " + bx2 + "," + by2
                  : "M" + bx1 + "," + by1 + " C" + bx1 + "," + (by1 + off) + " " + bx2 + "," + (by2 + off) + " " + bx2 + "," + by2;
        x1 = bx1; y1 = by1; x2 = bx2; y2 = by2;
      }
      s += '<g class="edge"><path d="' + path + '" marker-end="url(#kb-arrow)"/>';
      if (e.label) { var lx = (x1 + x2) / 2, ly = forward ? (y1 + y2) / 2 - 5 : (tb ? (y1 + y2) / 2 : Math.max(y1, y2) + 34); if (!forward && tb) lx = Math.max(x1, x2) + 44; s += '<text x="' + lx + '" y="' + ly + '" text-anchor="middle">' + esc(e.label) + "</text>"; }
      s += "</g>";
    });
    nodes.forEach(function (n) {
      var p = pos[n.id];
      s += '<g class="node ' + tone(n.tone) + '"><rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="8"/>';
      var ty = p.y + 12 + 13, cx = p.x + p.w / 2;
      if (!n._sub.length && n._label.length === 1) ty = p.y + p.h / 2 + 5;
      n._label.forEach(function (l) { s += '<text x="' + cx + '" y="' + ty + '" text-anchor="middle">' + esc(l) + "</text>"; ty += 17; });
      ty -= 2; n._sub.forEach(function (l) { s += '<text class="sub" x="' + cx + '" y="' + ty + '" text-anchor="middle">' + esc(l) + "</text>"; ty += 14; });
      s += "</g>";
    });
    s += "</svg>";
    var box = el("figure", "flow", s);
    if (d.caption) box.appendChild(el("figcaption", "", esc(d.caption)));
    return box;
  };

  components.compare = function (d) {
    var opts = d.options || [];
    var box = el("div", "compare");
    var grid = el("div", "grid cols-" + Math.min(3, Math.max(2, opts.length)));
    opts.forEach(function (o) {
      var card = el("article", "card option accent-" + (tone(o.tone) || "info"));
      var html = "<h3>" + esc(o.title) + "</h3>" + (o.summary ? "<p>" + esc(o.summary) + "</p>" : "");
      if (o.pros && o.pros.length) html += '<ul class="pros">' + o.pros.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
      if (o.cons && o.cons.length) html += '<ul class="cons">' + o.cons.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>";
      if (o.tradeoff) html += '<div class="tradeoff"><b>Trade-off:</b> ' + esc(o.tradeoff) + "</div>";
      if (o.tags && o.tags.length) html += '<div class="tags">' + o.tags.map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; }).join("") + "</div>";
      card.innerHTML = html; grid.appendChild(card);
    });
    box.appendChild(grid);
    if (d.criteria && d.criteria.length) {
      var t = '<table class="data"><thead><tr><th>Criterion</th>' + opts.map(function (o) { return "<th>" + esc(o.title) + "</th>"; }).join("") + "</tr></thead><tbody>";
      d.criteria.forEach(function (c) {
        t += "<tr><td>" + esc(c.name) + "</td>" + opts.map(function (o) { var v = c.scores ? c.scores[o.title] : ""; var cls = typeof v === "number" ? "score s" + Math.max(0, Math.min(3, v)) : ""; return '<td class="' + cls + '">' + esc(typeof v === "number" ? ["✕", "◔", "◑", "●"][Math.max(0, Math.min(3, v))] : v) + "</td>"; }).join("") + "</tr>";
      });
      box.appendChild(el("div", "", t + "</tbody></table>"));
    }
    return box;
  };

  // Drag-and-drop triage board with per-card notes, localStorage persistence, and export buttons.
  components.board = function (d) {
    var columns = d.columns || ["Now", "Next", "Later", "Cut"];
    var key = "kb:board:" + slug;
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { saved = {}; }
    var cards = (d.cards || []).map(function (c) { var s = saved[c.id] || {}; return { id: c.id, title: c.title, meta: c.meta || "", column: s.column || c.column || columns[0], note: s.note != null ? s.note : (c.note || "") }; });
    var box = el("div", "board");
    var cols = el("div", "board-cols"); box.appendChild(cols);
    var colEls = {};
    function persist() { var o = {}; cards.forEach(function (c) { o[c.id] = { column: c.column, note: c.note }; }); try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {} }
    function render() {
      cols.innerHTML = "";
      columns.forEach(function (name) {
        var col = el("section", "board-col"); col.setAttribute("data-col", name);
        var inCol = cards.filter(function (c) { return c.column === name; });
        col.appendChild(el("h4", "", esc(name) + "<span>" + inCol.length + "</span>"));
        inCol.forEach(function (c) {
          var card = el("div", "board-card"); card.draggable = true; card.setAttribute("data-id", c.id);
          card.innerHTML = '<div class="id">' + esc(c.id) + '</div><div class="title">' + esc(c.title) + "</div>" + (c.meta ? '<div class="meta">' + esc(c.meta) + "</div>" : "");
          var ta = el("textarea"); ta.placeholder = "rationale…"; ta.value = c.note; ta.rows = 1;
          ta.addEventListener("input", function () { c.note = ta.value; persist(); });
          ta.addEventListener("mousedown", function (e) { e.stopPropagation(); });
          card.appendChild(ta);
          card.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", c.id); card.classList.add("dragging"); });
          card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
          col.appendChild(card);
        });
        col.addEventListener("dragover", function (e) { e.preventDefault(); col.classList.add("over"); });
        col.addEventListener("dragleave", function () { col.classList.remove("over"); });
        col.addEventListener("drop", function (e) { e.preventDefault(); col.classList.remove("over"); var id = e.dataTransfer.getData("text/plain"); var c = cards.filter(function (x) { return x.id === id; })[0]; if (c) { c.column = name; persist(); render(); } });
        cols.appendChild(col); colEls[name] = col;
      });
    }
    function asMarkdown() { return columns.map(function (name) { var inCol = cards.filter(function (c) { return c.column === name; }); return "## " + name + "\n" + (inCol.length ? inCol.map(function (c) { return "- **" + c.id + "** " + c.title + (c.note ? " — " + c.note : ""); }).join("\n") : "- (none)"); }).join("\n\n") + "\n"; }
    function asJson() { return JSON.stringify({ columns: columns, cards: cards.map(function (c) { return { id: c.id, title: c.title, meta: c.meta, column: c.column, note: c.note }; }) }, null, 2); }
    function asPrompt() { return "Here is my triage from the board `" + slug + "` (" + (document.title || "") + "). Apply it: update the tracked items to these buckets and record the rationale.\n\n" + asMarkdown(); }
    var actions = el("div", "board-actions");
    var want = d.export || "all";
    var add = function (label, fn) { var b = el("button", "btn", label); b.onclick = function () { copyText(fn(), b); }; actions.appendChild(b); };
    if (want === "all" || want === "markdown") add("Copy as Markdown", asMarkdown);
    if (want === "all" || want === "json") add("Copy as JSON", asJson);
    if (want === "all" || want === "prompt") add("Copy as prompt", asPrompt);
    var reset = el("button", "btn ghost", "Reset"); reset.onclick = function () { try { localStorage.removeItem(key); } catch (e) {} location.reload(); }; actions.appendChild(reset);
    box.appendChild(actions);
    render();
    return box;
  };


  // Unified diff → colored rows with old/new line numbers; notes anchor by `new` line number or `match` substring.
  components.diff = function (d) {
    var text = String(d.diff || d.text || "").replace(/\r/g, "");
    var rows = [], oldN = 0, newN = 0, adds = 0, dels = 0;
    text.split("\n").forEach(function (raw) {
      if (/^(diff |index |--- |\+\+\+ )/.test(raw)) return;
      var h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (h) { oldN = +h[1]; newN = +h[2]; rows.push({ kind: "hunk", text: raw }); return; }
      if (raw === "" && rows.length && rows[rows.length - 1].kind !== "hunk") return;
      var c = raw[0], body = raw.slice(1);
      if (c === "+") { rows.push({ kind: "add", o: "", n: newN++, text: body }); adds++; }
      else if (c === "-") { rows.push({ kind: "del", o: oldN++, n: "", text: body }); dels++; }
      else if (c === "\\") { rows.push({ kind: "meta", text: raw }); }
      else { rows.push({ kind: "ctx", o: oldN++, n: newN++, text: body }); }
    });
    var notes = d.notes || [];
    var noteFor = function (r) { return notes.filter(function (nt) { return (nt.new != null && r.n === nt.new) || (nt.old != null && r.o === nt.old) || (nt.match && r.text.indexOf(nt.match) >= 0 && !nt._used && (nt._used = true)); }); };
    var box = el("div", "diff");
    if (d.file) box.dataset.file = d.file;
    var head = '<div class="diff-head"><span class="fname">' + esc(d.file || "") + '</span><span class="chip ok">+' + adds + '</span><span class="chip risk">−' + dels + "</span></div>";
    var body = '<table class="diff-table"><tbody>';
    rows.forEach(function (r) {
      if (r.kind === "hunk" || r.kind === "meta") { body += '<tr class="hunk"><td colspan="3">' + esc(r.text) + "</td></tr>"; return; }
      body += '<tr class="' + r.kind + '" data-line="' + (r.n === "" ? r.o : r.n) + '" data-side="' + (r.n === "" ? "old" : "new") + '"><td class="ln">' + (r.o === "" ? "" : r.o) + '</td><td class="ln">' + (r.n === "" ? "" : r.n) + '</td><td class="code"><span class="sign">' + (r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ") + "</span>" + esc(r.text) + "</td></tr>";
      noteFor(r).forEach(function (nt) { body += '<tr class="note"><td colspan="3"><div class="callout ' + (tone(nt.tone) || "note") + '"' + (nt.label ? ' data-label="' + esc(nt.label) + '"' : "") + ">" + (nt.text || "") + "</div></td></tr>"; });
    });
    box.innerHTML = head + body + "</tbody></table>";
    if (d.caption) box.appendChild(el("p", "small muted", esc(d.caption)));
    return box;
  };

  // Sequence diagram: actors across the top, lifelines, ordered messages (self-messages loop; dashed for returns).
  components.sequence = function (d) {
    var actors = d.actors || [], steps = d.steps || [];
    var colW = Math.max(150, Math.min(220, 40 + 9 * Math.max.apply(null, actors.map(function (a) { return String(a.label).length; }).concat([8]))));
    var x = {}; actors.forEach(function (a, i) { x[a.id] = 20 + colW / 2 + i * colW; });
    var top = 56, rowH = 46, width = 40 + colW * actors.length, height = top + steps.length * rowH + 30;
    var s = '<svg viewBox="0 0 ' + width + " " + height + '" width="' + width + '" height="' + height + '" role="img"><defs><marker id="kb-seq-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z"/></marker></defs>';
    actors.forEach(function (a) {
      var cx = x[a.id];
      s += '<g class="actor ' + tone(a.tone) + '"><line x1="' + cx + '" y1="40" x2="' + cx + '" y2="' + (height - 10) + '"/><rect x="' + (cx - colW / 2 + 14) + '" y="6" width="' + (colW - 28) + '" height="34" rx="8"/><text x="' + cx + '" y="28" text-anchor="middle">' + esc(a.label) + "</text></g>";
    });
    steps.forEach(function (st, i) {
      var y = top + i * rowH + 10, x1 = x[st.from], x2 = x[st.to]; if (x1 == null || x2 == null) return;
      var cls = "msg " + tone(st.tone) + (st.dashed || st.reply ? " dashed" : "");
      if (x1 === x2) { // self message
        s += '<g class="' + cls + '"><path d="M' + x1 + "," + y + " h40 v22 h-40" + '" marker-end="url(#kb-seq-arrow)"/><text x="' + (x1 + 48) + '" y="' + (y + 15) + '">' + esc(st.label || "") + "</text></g>";
      } else {
        var dir = x2 > x1 ? 1 : -1, xe = x2 - dir * 4;
        s += '<g class="' + cls + '"><line x1="' + x1 + '" y1="' + y + '" x2="' + xe + '" y2="' + y + '" marker-end="url(#kb-seq-arrow)"/><text x="' + ((x1 + x2) / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + esc(st.label || "") + "</text>" + (st.note ? '<text class="note" x="' + ((x1 + x2) / 2) + '" y="' + (y + 14) + '" text-anchor="middle">' + esc(st.note) + "</text>" : "") + "</g>";
      }
      if (st.gap) s += '<text class="gap" x="20" y="' + (y + 30) + '">' + esc(st.gap) + "</text>";
    });
    s += "</svg>";
    var box = el("figure", "sequence", s);
    if (d.caption) box.appendChild(el("figcaption", "", esc(d.caption)));
    return box;
  };

  // Line chart (series over an index or numeric x) and a compact sparkline variant.
  function lineSvg(d, spark) {
    var series = (d.series || (d.values ? [{ values: d.values, label: d.label, tone: d.tone }] : [])).map(function (sr) {
      var pts = sr.points ? sr.points.map(function (p) { return { x: +p[0], y: +p[1] }; }) : (sr.values || []).map(function (v, i) { return { x: i, y: +v }; });
      return { label: sr.label || "", tone: tone(sr.tone) || "info", pts: pts.filter(function (p) { return isFinite(p.y); }) };
    });
    var all = [].concat.apply([], series.map(function (sr) { return sr.pts; }));
    if (!all.length) throw new Error("line: no points");
    var xs = all.map(function (p) { return p.x; }), ys = all.map(function (p) { return p.y; });
    var xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    var ymin = d.min != null ? +d.min : Math.min(0, Math.min.apply(null, ys)), ymax = d.max != null ? +d.max : Math.max.apply(null, ys);
    if (ymax === ymin) ymax = ymin + 1; if (xmax === xmin) xmax = xmin + 1;
    var W = spark ? (d.width || 120) : (d.width || 720), H = spark ? (d.height || 28) : (d.height || 240);
    var padL = spark ? 2 : 48, padR = spark ? 2 : 16, padT = spark ? 2 : 12, padB = spark ? 2 : 28;
    var sx = function (v) { return padL + (v - xmin) / (xmax - xmin) * (W - padL - padR); }, sy = function (v) { return H - padB - (v - ymin) / (ymax - ymin) * (H - padT - padB); };
    var fmt = function (v) { return (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : +v.toFixed(2)) + (d.unit || ""); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" class="' + (spark ? "spark" : "") + '">';
    if (!spark) {
      for (var t = 0; t <= 4; t++) { var yv = ymin + (ymax - ymin) * t / 4, yy = sy(yv); s += '<line class="grid" x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '"/><text class="tick" x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + fmt(yv) + "</text>"; }
      var labels = d.x || [];
      var n = labels.length || Math.min(8, Math.round(xmax - xmin) + 1);
      for (var i = 0; i < n; i++) { var xv = labels.length ? i : xmin + (xmax - xmin) * i / Math.max(1, n - 1), lab = labels.length ? labels[i] : fmt(xv); if (labels.length && (labels.length > 12 && i % Math.ceil(labels.length / 12))) continue; s += '<text class="tick" x="' + sx(xv) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + "</text>"; }
    }
    series.forEach(function (sr) {
      var path = sr.pts.map(function (p, i) { return (i ? "L" : "M") + sx(p.x).toFixed(1) + "," + sy(p.y).toFixed(1); }).join(" ");
      s += '<g class="series ' + sr.tone + '"><path d="' + path + '"/>';
      if (!spark) sr.pts.forEach(function (p) { s += '<circle cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="3"><title>' + esc(sr.label) + " " + fmt(p.y) + "</title></circle>"; });
      var last = sr.pts[sr.pts.length - 1];
      if (spark) s += '<circle cx="' + sx(last.x).toFixed(1) + '" cy="' + sy(last.y).toFixed(1) + '" r="2.5"/>';
      s += "</g>";
    });
    s += "</svg>";
    return { svg: s, series: series, fmt: fmt };
  }
  components.line = function (d) {
    var r = lineSvg(d, false);
    var box = el("figure", "line", r.svg);
    if (r.series.length > 1 || r.series[0].label) box.appendChild(el("div", "legend", r.series.map(function (sr) { var last = sr.pts[sr.pts.length - 1]; return '<span class="' + sr.tone + '"><i></i>' + esc(sr.label) + (last ? ' <b>' + r.fmt(last.y) + "</b>" : "") + "</span>"; }).join("")));
    if (d.caption) box.appendChild(el("figcaption", "", esc(d.caption)));
    return box;
  };
  components.sparkline = function (d) { var r = lineSvg(d, true); var box = el("span", "sparkline", r.svg); if (d.showLast !== false) { var last = r.series[0].pts[r.series[0].pts.length - 1]; box.appendChild(el("b", "", r.fmt(last.y))); } return box; };

  // Tree: nested labels with connectors; nodes = [{label, note?, tone?, children?}]; collapsed beyond `open` depth.
  components.tree = function (d) {
    var openDepth = d.open != null ? +d.open : 99;
    var render = function (nodes, depth) {
      return "<ul>" + nodes.map(function (n) {
        var kids = n.children && n.children.length;
        var label = '<span class="lbl ' + tone(n.tone) + '">' + esc(n.label) + "</span>" + (n.note ? '<span class="note">' + n.note + "</span>" : "");
        if (!kids) return '<li class="leaf">' + label + "</li>";
        return "<li><details" + (depth < openDepth ? " open" : "") + "><summary>" + label + "</summary>" + render(n.children, depth + 1) + "</details></li>";
      }).join("") + "</ul>";
    };
    var box = el("div", "tree", render(d.nodes || d, 0));
    if (d.caption) box.appendChild(el("p", "small muted", esc(d.caption)));
    return box;
  };

  // Matrix / heatmap: rows × cols; cell = tone string | {tone, label, title, href}; optional legend {tone: meaning}.
  components.matrix = function (d) {
    var rows = d.rows || [], cols = d.cols || [];
    var cell = function (r, c, ri, ci) { var v = Array.isArray(d.cells) ? (d.cells[ri] || [])[ci] : ((d.cells || {})[r] || {})[c]; if (v == null) return { tone: "", label: "" }; return typeof v === "string" ? { tone: tone(v) || "", label: d.symbols === false ? "" : ({ ok: "●", warn: "◑", risk: "✕", info: "○", muted: "–" }[v] || v) } : { tone: tone(v.tone), label: v.label != null ? v.label : "", title: v.title, href: v.href }; };
    var t = '<table class="data matrix"><thead><tr><th>' + esc(d.corner || "") + "</th>" + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r, ri) { t += "<tr><th>" + esc(r) + "</th>" + cols.map(function (c, ci) { var v = cell(r, c, ri, ci); var inner = v.href ? '<a href="' + esc(v.href) + '">' + esc(v.label) + "</a>" : esc(v.label); return '<td class="cell ' + v.tone + '"' + (v.title ? ' title="' + esc(v.title) + '"' : "") + ">" + inner + "</td>"; }).join("") + "</tr>"; });
    t += "</tbody></table>";
    var box = el("div", "matrix-wrap", t);
    if (d.legend) box.appendChild(el("div", "legend", Object.keys(d.legend).map(function (k) { return '<span class="' + tone(k) + '"><i></i>' + esc(d.legend[k]) + "</span>"; }).join("")));
    if (d.caption) box.appendChild(el("p", "small muted", esc(d.caption)));
    return box;
  };

  function renderComponents() {
    [].forEach.call(main.querySelectorAll('script[type="application/json"][data-component]'), function (script) {
      var name = script.getAttribute("data-component");
      try {
        var data = JSON.parse(script.textContent);
        if (!components[name]) throw new Error("unknown component: " + name);
        var node = components[name](data);
        script.parentNode.replaceChild(node, script);
      } catch (e) {
        console.error("component " + name + ": " + e.message);
        script.parentNode.replaceChild(el("div", "callout risk", "<b>Component <code>" + esc(name) + "</code> failed:</b> " + esc(e.message)), script);
      }
    });
  }

  // ---------- boot ----------
  function boot() {
    renderHeader();
    renderComponents();
    wireTabs(); wireCopy(); wireAnnotated(); wireSortable(); wireDeck();
    renderToc();
    console.log("[kb-ready]");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
