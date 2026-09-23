/* Annotation layer for `artifact session`. Injected at serve time; talks to the local session server.
   Select text → note. Notes persist in the sidecar; "Send to agent" delivers them via pi-intercom. */
(function () {
  "use strict";
  var S = window.__kbSession || {};
  var main = document.getElementById("kb-content") || document.body;
  var el = function (tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var ICON = { question: "❓", note: "📝", change: "✏️", approve: "✅" };
  var api = function (path, opts) { return fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {})).then(function (r) { return r.json(); }); };
  var state = { notes: [], updated: "", target: S.target || "", pinned: !!S.pinned, peers: [], focus: null };

  // ---------- UI scaffolding ----------
  var fab = el("div", "", '<button type="button">＋ Note</button>'); fab.id = "kb-fab";
  var pop = el("div"); pop.id = "kb-pop";
  var toggle = el("button", "", 'Notes <span class="n">0</span>'); toggle.id = "kb-toggle"; toggle.type = "button";
  var panel = el("aside"); panel.id = "kb-panel";
  var toast = el("div"); toast.id = "kb-toast";
  document.body.append(fab, pop, toggle, panel, toast);
  function say(msg) { toast.textContent = msg; toast.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(function () { toast.classList.remove("show"); }, 1800); }
  toggle.onclick = function () { setPanel(!panel.classList.contains("open")); };
  function setPanel(open) { panel.classList.toggle("open", open); document.body.classList.toggle("kb-panel-open", open); }

  // ---------- anchors ----------
  function anchorFor(node, endNode) {
    var elx = node.nodeType === 1 ? node : node.parentElement;
    var section = elx && elx.closest("section[id], section, .slide");
    var h = section && section.querySelector("h1,h2,h3");
    var a = { section: section && section.id || undefined, heading: h ? h.textContent.trim() : undefined };
    // diff rows carry file + line so the agent can jump straight to path:line
    var box = elx && elx.closest(".diff[data-file]"), row = elx && elx.closest("tr[data-line]");
    if (box) a.file = box.dataset.file;
    if (row) {
      a.side = row.dataset.side; a.line = row.dataset.line;
      var endEl = endNode && (endNode.nodeType === 1 ? endNode : endNode.parentElement), endRow = endEl && endEl.closest("tr[data-line]");
      if (endRow && endRow !== row && box && box.contains(endRow)) { var l = [+row.dataset.line, +endRow.dataset.line].sort(function (x, y) { return x - y; }); a.line = l[0] + "-" + l[1]; }
    }
    return a;
  }
  var pending = null; // { anchor, range }
  var PICKABLE = ".diff-table tr[data-line], .flow .node, .bars .bar, .timeline .tl, ol.steps > li, .board-card, .board-col, .kpi, .card, .callout, .annotated, .code, pre, .tabs, table.data, figure, details, .kpis, .grid, h1, h2, h3, li, p, section";
  function cssPath(node) {
    var parts = [];
    for (var n = node; n && n !== main && n.nodeType === 1; n = n.parentElement) {
      if (n.id && document.querySelectorAll("#" + CSS.escape(n.id)).length === 1) { parts.unshift("#" + CSS.escape(n.id)); return parts.join(" > "); }
      var tag = n.tagName.toLowerCase(), i = 1, sib = n;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === n.tagName) i++;
      parts.unshift(tag + ":nth-of-type(" + i + ")");
    }
    return "#kb-content > " + parts.join(" > ");
  }
  function pickTarget(node) { var e = node.nodeType === 1 ? node : node.parentElement; if (!e || !main.contains(e) || e.closest("#kb-panel,#kb-pop,#kb-fab,.kb-header,.kb-footer,.kb-toc")) return null; return e.closest(PICKABLE) || e; }
  function elementAnchor(target) {
    var label = (target.getAttribute("data-title") || target.getAttribute("aria-label") || target.innerText || target.textContent || target.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
    var kindOf = target.matches("tr[data-line]") ? "diff line" : target.matches(".flow .node") ? "flow node" : target.matches(".bars .bar") ? "bar" : target.matches(".timeline .tl") ? "timeline entry" : target.matches(".board-card") ? "card" : target.matches(".kpi") ? "kpi" : target.matches(".callout") ? "callout" : target.matches(".card") ? "card" : target.matches("pre,.code,.annotated") ? "code block" : target.matches("table") ? "table" : target.tagName.toLowerCase();
    return Object.assign(anchorFor(target), { selector: cssPath(target), element: kindOf, label: label });
  }
  var pinMode = false, hoverEl = null;
  function setPin(on) { pinMode = on; document.body.classList.toggle("kb-pin-mode", on); if (!on && hoverEl) { hoverEl.classList.remove("kb-pin-hover"); hoverEl = null; } say(on ? "Pin mode: click an element (Esc to cancel)" : "Pin mode off"); }
  document.addEventListener("mousemove", function (e) { if (!pinMode) return; var t = pickTarget(e.target); if (t === hoverEl) return; if (hoverEl) hoverEl.classList.remove("kb-pin-hover"); hoverEl = t; if (t) t.classList.add("kb-pin-hover"); });
  document.addEventListener("click", function (e) {
    if (!(pinMode || e.altKey)) return;
    var t = pickTarget(e.target); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    if (pinMode) setPin(false);
    window.getSelection().removeAllRanges(); fab.style.display = "none";
    openPop(elementAnchor(t), t.getBoundingClientRect());
  }, true);
  document.addEventListener("mouseup", function (e) {
    if (pop.contains(e.target) || panel.contains(e.target) || fab.contains(e.target)) return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !main.contains(sel.anchorNode)) { fab.style.display = "none"; return; }
      var text = sel.toString().trim(); if (text.length < 2) { fab.style.display = "none"; return; }
      var r = sel.getRangeAt(0), rect = r.getBoundingClientRect();
      pending = { anchor: Object.assign(anchorFor(sel.anchorNode, sel.focusNode), { quote: text }), rect: rect };
      fab.style.left = (rect.left + rect.width / 2) + "px"; fab.style.top = rect.top + "px"; fab.style.display = "block";
    }, 0);
  });
  fab.querySelector("button").onclick = function () { fab.style.display = "none"; openPop(pending.anchor, pending.rect); };
  document.addEventListener("keydown", function (e) {
    if (e.target.matches("textarea,input,select,[contenteditable]")) return;
    if (e.key === "n" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openPop({ heading: "(whole page)" }, null); }
    if (e.key === "Escape") { pop.style.display = "none"; if (pinMode) setPin(false); }
    if (e.key === "p" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setPin(!pinMode); }
  });

  // ---------- note popover ----------
  var popKind = "question";
  function openPop(anchor, rect) {
    pop.innerHTML = '<div class="quote">' + (anchor.file ? "<code>" + esc(anchor.file + (anchor.line ? ":" + anchor.line : "")) + "</code> " : "") + (anchor.selector ? "📌 " + esc(anchor.element) + ": <b>" + esc(anchor.label) + "</b>" : anchor.quote ? "“" + esc(anchor.quote.slice(0, 200)) + "”" : "General note on " + esc(anchor.heading || "the page")) + "</div>" +
      '<div class="kinds">' + ["question", "note", "change", "approve"].map(function (k) { return '<button type="button" data-k="' + k + '" aria-pressed="' + (k === popKind) + '">' + ICON[k] + " " + k + "</button>"; }).join("") + "</div>" +
      '<textarea placeholder="What do you want to ask or change?"></textarea>' +
      '<div class="row"><span class="hint">⌘↩ to save</span><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button type="button" class="btn" data-a="save">Save note</button></div>';
    pop.querySelectorAll(".kinds button").forEach(function (b) { b.onclick = function () { popKind = b.dataset.k; pop.querySelectorAll(".kinds button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); }; });
    var ta = pop.querySelector("textarea");
    var save = function () {
      var text = ta.value.trim(); if (!text) { ta.focus(); return; }
      api("/notes", { method: "POST", body: JSON.stringify({ kind: popKind, text: text, anchor: anchor }) }).then(function () { pop.style.display = "none"; window.getSelection().removeAllRanges(); refresh(true); say("Saved"); });
    };
    pop.querySelector('[data-a="save"]').onclick = save;
    pop.querySelector('[data-a="cancel"]').onclick = function () { pop.style.display = "none"; };
    ta.addEventListener("keydown", function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); });
    pop.style.visibility = "hidden";
    pop.style.display = "block";
    var popH = pop.offsetHeight || 280;
    var w = Math.min(350, window.innerWidth - 32);
    var left = rect ? Math.min(window.innerWidth - w - 16, Math.max(16, rect.left)) : (window.innerWidth - w) / 2;
    var top;
    if (rect) {
      var spaceBelow = window.innerHeight - rect.bottom;
      var spaceAbove = rect.top;
      if (spaceBelow >= popH + 16 || spaceBelow >= spaceAbove) {
        top = Math.min(window.innerHeight - popH - 16, rect.bottom + 8);
      } else {
        top = Math.max(16, rect.top - popH - 8);
      }
    } else {
      top = Math.max(16, (window.innerHeight - popH) / 2);
    }
    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "visible";
    ta.focus();
  }

  // ---------- highlights ----------
  function clearHighlights() {
    document.querySelectorAll(".kb-anno-box").forEach(function (b) { b.classList.remove("kb-anno-box", "question", "note", "change", "approve", "resolved", "focus"); delete b.dataset.note; b.onclick = null; });
    document.querySelectorAll("mark.kb-anno").forEach(function (m) { var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize && p.normalize(); });
  }
  function highlightElement(note) {
    var a = note.anchor, t = null;
    try { t = a.selector ? document.querySelector(a.selector) : null; } catch (e) {}
    if (!t && a.label) { // selector drifted (artifact rebuilt with different structure): fall back to label text within the section
      var scope = (a.section && document.getElementById(a.section)) || main;
      t = [].filter.call(scope.querySelectorAll(PICKABLE), function (x) { var t = (x.innerText || x.textContent).replace(/\s+/g, " ").trim().slice(0, 80); return t === a.label || x.textContent.replace(/\s+/g, " ").trim().slice(0, 80) === a.label; })[0] || null;
    }
    if (!t) return;
    t.classList.add("kb-anno-box", note.kind); if (note.status === "resolved") t.classList.add("resolved");
    t.dataset.note = note.id; t.onclick = function (e) { if (pinMode || e.altKey) return; e.stopPropagation(); focusNote(note.id, true); };
  }
  function highlight(note) {
    if (note.anchor && note.anchor.selector) return highlightElement(note);
    if (note.anchor && note.anchor.file && note.anchor.line) return highlightRows(note);
    var q = note.anchor && note.anchor.quote; if (!q) return;
    var scope = (note.anchor.file && document.querySelector('.diff[data-file="' + CSS.escape(note.anchor.file) + '"]')) || (note.anchor.section && document.getElementById(note.anchor.section)) || main;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentElement.closest("#kb-panel,#kb-pop,script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    var nodes = [], text = "", n;
    while ((n = walker.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.nodeValue; }
    var norm = function (s) { return s.replace(/\s+/g, " "); };
    var idx = norm(text).indexOf(norm(q));
    if (idx < 0) return;
    // map normalized index back: normalization only collapses whitespace runs, so walk both strings
    var map = [], j = 0; for (var i = 0; i < text.length; i++) { if (/\s/.test(text[i]) && i > 0 && /\s/.test(text[i - 1])) map.push(j - 1); else { map.push(j); j++; } }
    var startRaw = map.indexOf(idx), endRaw = map.lastIndexOf(idx + norm(q).length - 1) + 1;
    if (startRaw < 0 || endRaw <= startRaw) return;
    var find = function (pos) { for (var k = nodes.length - 1; k >= 0; k--) if (nodes[k].start <= pos) return { node: nodes[k].node, off: pos - nodes[k].start }; };
    var a = find(startRaw), b = find(Math.max(startRaw, endRaw - 1)); if (!a || !b) return;
    try {
      var r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, Math.min(b.node.nodeValue.length, b.off + 1));
      var m = el("mark", "kb-anno " + note.kind + (note.status === "resolved" ? " resolved" : "")); m.dataset.note = note.id; m.title = ICON[note.kind] + " " + note.text;
      if (a.node === b.node) r.surroundContents(m);
      else { var frag = r.extractContents(); m.appendChild(frag); r.insertNode(m); }
      m.onclick = function (e) { e.stopPropagation(); focusNote(note.id, true); };
    } catch (e) { /* range crosses element boundaries in a way we cannot wrap; panel still shows it */ }
  }
  function highlightRows(note) { // wrapping text across <tr>s would break the table: outline the rows instead
    var a = note.anchor, box = document.querySelector('.diff[data-file="' + CSS.escape(a.file) + '"]'); if (!box) return;
    var r = String(a.line).split("-"), lo = +r[0], hi = +(r[1] || r[0]);
    box.querySelectorAll('tr[data-side="' + (a.side || "new") + '"]').forEach(function (t) {
      var n = +t.dataset.line; if (n < lo || n > hi) return;
      t.classList.add("kb-anno-box", note.kind); if (note.status === "resolved") t.classList.add("resolved");
      t.dataset.note = note.id; t.onclick = function (e) { if (pinMode || e.altKey || !window.getSelection().isCollapsed) return; e.stopPropagation(); focusNote(note.id, true); };
    });
  }
  function focusNote(id, openPanel) {
    state.focus = id;
    document.querySelectorAll("mark.kb-anno, .kb-anno-box").forEach(function (m) { m.classList.toggle("focus", m.dataset.note === id); });
    document.querySelectorAll(".kb-note").forEach(function (c) { c.classList.toggle("focus", c.dataset.id === id); });
    if (openPanel) setPanel(true);
    var card = panel.querySelector('.kb-note[data-id="' + id + '"]'); if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- panel ----------
  function copyExport(format, success) {
    fetch("/export?format=" + encodeURIComponent(format)).then(function (r) {
      if (!r.ok) throw new Error("export unavailable");
      return r.text();
    }).then(function (text) {
      return navigator.clipboard.writeText(text);
    }).then(function () { say(success); }).catch(function () { say("Copy failed — use artifact notes " + S.slug + " --format " + format); });
  }
  function renderPanel() {
    var open = state.notes.filter(function (n) { return n.status === "open"; }).length;
    toggle.querySelector(".n").textContent = state.notes.length + (open ? " · " + open + " unsent" : "");
    var peerOpts = state.peers.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === state.target ? " selected" : "") + ">" + esc((p.name || p.id.slice(0, 8)) + (p.sameCwd ? "" : " · " + p.cwd.split("/").pop()) + (p.status ? " · " + p.status : "")) + "</option>"; }).join("");
    if (state.target && !state.peers.some(function (p) { return p.id === state.target; })) peerOpts = '<option value="' + esc(state.target) + '" selected>' + esc(state.target.slice(0, 8)) + " (from link)</option>" + peerOpts;
    panel.innerHTML = "<header><h2>Notes on <code>" + esc(S.slug) + '</code><button type="button" data-a="close">close ✕</button></h2>' +
      '<div class="transport"><span>Pi intercom <em>optional</em></span><div class="target">to <select>' + (peerOpts || '<option value="">no Pi sessions found</option>') + "</select>" + (state.pinned ? '<span title="preselected by the link (?to=)">🔗</span>' : "") + "</div></div></header>" +
      '<div class="actions"><button type="button" class="btn" data-a="send"' + (open && state.target ? "" : " disabled") + ">Send " + open + ' via Pi</button><button type="button" class="btn ghost" data-a="prompt">Copy Codex follow-up</button><button type="button" class="btn ghost" data-a="markdown">Copy Markdown</button><button type="button" class="btn ghost" data-a="json">Copy JSON</button><button type="button" class="btn ghost" data-a="general">＋ General note</button><button type="button" class="btn ghost" data-a="pin" title="or ⌥-click any element · p">📌 Pin element</button><button type="button" class="btn ghost" data-a="peers" title="refresh Pi sessions">⟳</button></div>' +
      '<div class="list">' + (state.notes.length ? state.notes.map(noteCard).join("") : '<div class="empty">Select text and click <b>＋ Note</b>; <b>⌥-click</b> (or <kbd>p</kbd>) to pin a whole element such as a diagram node or card; <kbd>n</kbd> for a general note.</div>') + "</div>";
    panel.querySelector('[data-a="close"]').onclick = function () { setPanel(false); };
    panel.querySelector("select").onchange = function (e) { state.target = e.target.value; api("/target", { method: "POST", body: JSON.stringify({ target: state.target }) }); };
    panel.querySelector('[data-a="general"]').onclick = function () { openPop({ heading: "(whole page)" }, null); };
    panel.querySelector('[data-a="peers"]').onclick = loadPeers;
    panel.querySelector('[data-a="pin"]').onclick = function () { setPin(true); };
    panel.querySelector('[data-a="prompt"]').onclick = function () { copyExport("prompt", "Codex follow-up copied"); };
    panel.querySelector('[data-a="markdown"]').onclick = function () { copyExport("markdown", "Markdown copied"); };
    panel.querySelector('[data-a="json"]').onclick = function () { copyExport("json", "Canonical JSON copied"); };
    panel.querySelector('[data-a="send"]').onclick = function (e) {
      e.target.disabled = true; e.target.textContent = "Sending…";
      api("/send", { method: "POST", body: JSON.stringify({ to: state.target }) }).then(function (r) { if (r.error) say("Failed: " + r.error); else if (!r.delivered) say("Not delivered: " + (r.reason || "unknown")); else say("Sent " + r.count + " note" + (r.count === 1 ? "" : "s") + " to the agent"); refresh(true); });
    };
    panel.querySelectorAll(".kb-note").forEach(function (card) {
      var id = card.dataset.id;
      card.onclick = function (e) { if (e.target.closest("button,textarea")) return; focusNote(id, false); var m = document.querySelector('mark.kb-anno[data-note="' + id + '"], .kb-anno-box[data-note="' + id + '"]'); if (m) m.scrollIntoView({ block: "center", behavior: "smooth" }); };
      var op = function (a, fn) { var b = card.querySelector('[data-op="' + a + '"]'); if (b) b.onclick = fn; };
      op("resolve", function () { api("/notes/" + id, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) }).then(function () { refresh(true); }); });
      op("reopen", function () { api("/notes/" + id, { method: "PATCH", body: JSON.stringify({ status: "open" }) }).then(function () { refresh(true); }); });
      op("delete", function () { if (confirm("Delete this note?")) api("/notes/" + id, { method: "DELETE" }).then(function () { refresh(true); }); });
      op("reply", function () {
        if (card.querySelector(".reply-box")) return;
        var ta = el("textarea", "reply-box"); ta.placeholder = "Reply… (⌘↩)"; card.appendChild(ta); ta.focus();
        ta.onkeydown = function (e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && ta.value.trim()) api("/notes/" + id + "/reply", { method: "POST", body: JSON.stringify({ text: ta.value }) }).then(function () { refresh(true); }); if (e.key === "Escape") ta.remove(); };
      });
    });
    if (state.focus) focusNote(state.focus, false);
  }
  function noteCard(n) {
    return '<div class="kb-note' + (n.id === state.focus ? " focus" : "") + '" data-id="' + n.id + '"><div class="head">' + ICON[n.kind] + " <b>" + n.kind + "</b>" + (n.anchor.file ? " · <code>" + esc(n.anchor.file + (n.anchor.line ? ":" + n.anchor.line : "")) + "</code>" : n.anchor.heading ? " · " + esc(n.anchor.heading) : "") + '<span class="st ' + n.status + '">' + n.status + "</span></div>" +
      (n.anchor.selector ? '<div class="quote">📌 ' + esc(n.anchor.element || "element") + ": " + esc(n.anchor.label || "") + "</div>" : n.anchor.quote ? '<div class="quote">“' + esc(n.anchor.quote) + "”</div>" : "") + '<div class="text">' + esc(n.text) + "</div>" +
      n.replies.map(function (r) { return '<div class="reply"><b>' + esc(r.by) + "</b> " + esc(r.text) + "</div>"; }).join("") +
      '<div class="ops"><button type="button" data-op="reply">reply</button>' + (n.status === "resolved" ? '<button type="button" data-op="reopen">reopen</button>' : '<button type="button" data-op="resolve">resolve</button>') + '<button type="button" data-op="delete">delete</button><span style="margin-left:auto;color:var(--muted)">' + n.id + "</span></div></div>";
  }
  // ---------- sync ----------
  function refresh(force) {
    return api("/notes").then(function (d) {
      if (!force && d.updated === state.updated) return;
      state.updated = d.updated; state.notes = d.notes || [];
      clearHighlights(); state.notes.forEach(highlight); renderPanel();
    }).catch(function () {});
  }
  function loadPeers() { return api("/peers").then(function (d) { state.peers = d.peers || []; if (d.target && !state.pinned && !state.target) state.target = d.target; if (!state.target && state.peers.length) { var same = state.peers.filter(function (p) { return p.sameCwd; }); state.target = (same[0] || state.peers[0]).id; api("/target", { method: "POST", body: JSON.stringify({ target: state.target }) }); } renderPanel(); }).catch(function () { renderPanel(); }); }
  function watchVersion() { api("/version").then(function (v) { if (v.version && S.version && v.version !== S.version) { say("Artifact changed — reloading"); sessionStorage.setItem("kb:scroll", String(window.scrollY)); setTimeout(function () { location.reload(); }, 600); } }).catch(function () {}); }
  var y = sessionStorage.getItem("kb:scroll"); if (y) { sessionStorage.removeItem("kb:scroll"); window.scrollTo(0, +y); }
  refresh(true).then(loadPeers);
  setInterval(function () { refresh(false); watchVersion(); }, 3000);
  console.log("[kb-annotate] ready");
})();
