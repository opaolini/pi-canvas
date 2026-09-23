import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from '@earendil-works/pi-ai';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Shared annotation layer + styles from this package's artifacts runtime.
const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '../artifacts/runtime');

// Optional: pi-extensible-workflows installed globally (also honours PI_CODING_AGENT_DIR). Without it
// only the review_gate tool is registered; with it, workflows also get a reviewGate() function.
let workflowEntry = '';
let workflows: any = null;
try {
  workflowEntry = createRequire(join(getAgentDir(), 'npm', 'package.json')).resolve('pi-extensible-workflows');
  // Import through Pi's loader so its SDK peer aliases are honored (native require is not).
  workflows = await import(workflowEntry);
} catch { workflows = null; }

export interface ReviewGateOptions {
  plan?: string;
  title?: string;
  documents?: string[];
  results?: any;
  runId?: string;
  checkpointName?: string;
}

export interface Note {
  id: string;
  kind: 'question' | 'note' | 'change' | 'approve';
  text: string;
  anchor?: Record<string, string>;
  created: string;
  status?: string;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export function renderMarkdownDoc(root: string, title: string, markdownContent: string) {
  const markedPath = workflowEntry ? resolve(dirname(workflowEntry), '../trajectory/assets/marked.min.js') : '';
  let bodyHtml = '';
  if (markedPath && existsSync(markedPath)) {
    try {
      const markedCode = readFileSync(markedPath, 'utf8');
      const ctx: any = {};
      const fn = new Function('exports', 'window', 'globalThis', markedCode);
      fn(ctx, ctx, ctx);
      bodyHtml = ctx.marked.parse(markdownContent, { mangle: false, headerIds: false });
    } catch {
      bodyHtml = `<pre style="white-space: pre-wrap;">${esc(markdownContent)}</pre>`;
    }
  } else {
    bodyHtml = `<pre style="white-space: pre-wrap;">${esc(markdownContent)}</pre>`;
  }
  const css = readFileSync(join(RUNTIME, 'tokens.css'), 'utf8') + '\n' +
              readFileSync(join(RUNTIME, 'base.css'), 'utf8');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${css}
body { margin: 0; padding: 32px; background: var(--paper); color: var(--ink); font-family: var(--font-sans); }
main { max-width: 960px; margin: 0 auto; line-height: 1.6; }
h1, h2, h3, h4 { color: var(--ink); margin-top: 1.4em; margin-bottom: 0.5em; }
code { font-family: var(--font-mono); background: var(--canvas); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
pre { background: var(--code-bg); color: var(--code-ink); padding: 16px; border-radius: var(--radius); overflow-x: auto; }
pre code { background: transparent; padding: 0; color: inherit; }
table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
th { background: var(--canvas); font-weight: 600; }
ul, ol { padding-left: 24px; }
li { margin-bottom: 6px; }
</style>
</head>
<body>
<main id="kb-content">
${bodyHtml}
</main>
</body>
</html>`;
}

export function annotated(root: string, html: string, id: string) {
  const annotateCss = existsSync(join(RUNTIME, 'annotate.css'))
    ? readFileSync(join(RUNTIME, 'annotate.css'), 'utf8')
    : '';
  const annotateJs = existsSync(join(RUNTIME, 'annotate.js'))
    ? readFileSync(join(RUNTIME, 'annotate.js'), 'utf8')
    : '';

  const fabOverride = `
    #kb-fab button {
      background: #6f4bf2 !important;
      color: #ffffff !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      padding: 8px 14px !important;
      border-radius: 999px !important;
      box-shadow: 0 4px 16px rgba(111, 75, 242, 0.45) !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      cursor: pointer !important;
    }
  `;
  const config = `<script>window.__kbSession = { slug: ${JSON.stringify(id)}, file: 'review.html', target: '', pinned: true, version: '1.0' };</script>`;
  const boot = `<style>${annotateCss}\n${fabOverride}</style>${config}\n<script>${annotateJs}</script>`;
  return html.replace(/<\/body>/i, boot + '</body>');
}

export function shell(root: string, title: string) {
  const css = readFileSync(join(RUNTIME, 'tokens.css'), 'utf8') + '\n' +
              readFileSync(join(RUNTIME, 'base.css'), 'utf8');

  return String.raw`<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Review Gate</title>
<style>
${css}
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sans);
  padding: 24px;
}
main {
  max-width: 1200px;
  margin: 0 auto;
}
.gate-header {
  position: sticky;
  top: 12px;
  background: var(--paper);
  padding: 20px 24px;
  z-index: 100;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  margin-bottom: 24px;
}
.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
}
.header-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.status-pill.waiting { background: var(--warn-soft); color: var(--warn); }
.status-pill.approved { background: var(--ok-soft); color: var(--ok); }
.status-pill.rejected { background: var(--risk-soft); color: var(--risk); }

.status-desc {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--muted);
}
.actions {
  display: flex;
  gap: 12px;
}
.btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-approve {
  background: var(--ok);
  color: #fff;
}
.btn-approve:hover:not(:disabled) {
  background: #117a4f;
  transform: translateY(-1px);
}
.btn-changes {
  background: var(--warn-soft);
  color: var(--warn);
  border: 1px solid var(--warn);
}
.btn-changes:hover:not(:disabled) {
  background: #fdf3e5;
}
.btn-cancel {
  background: var(--paper);
  color: var(--risk);
  border: 1px solid var(--line);
}
.btn-cancel:hover:not(:disabled) {
  background: var(--risk-soft);
}

.review-content {
  background: var(--paper);
  border-radius: var(--radius);
  border: 1px solid var(--line);
  overflow: hidden;
  box-shadow: var(--shadow);
}
.review-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.review-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.tabs-nav {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.tab-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: var(--canvas);
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.tab-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

iframe {
  width: 100%;
  height: 750px;
  border: none;
  background: #fff;
  display: block;
}

.feedback-box {
  margin-top: 24px;
  background: var(--paper);
  border-radius: var(--radius);
  border: 1px solid var(--line);
  padding: 20px 24px;
}
.feedback-box h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
}
.feedback-box p {
  margin: 0 0 16px 0;
  font-size: 13.5px;
  color: var(--muted);
}
.feedback-box textarea {
  width: 100%;
  height: 70px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-family: var(--font-sans);
  font-size: 14px;
  resize: vertical;
  background: var(--canvas);
  color: var(--ink);
  margin-top: 6px;
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.note-item {
  padding: 10px 14px;
  background: var(--canvas);
  border-radius: 6px;
  border: 1px solid var(--line);
  font-size: 13px;
}
.note-kind {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  color: var(--accent);
  margin-right: 6px;
}

/* Native HTML Dialog Modal */
dialog.native-modal {
  border: none;
  border-radius: var(--radius);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  background: var(--paper);
  color: var(--ink);
  padding: 24px 28px;
  max-width: 540px;
  width: 90%;
  margin: auto;
}
dialog.native-modal::backdrop {
  background: rgba(23, 21, 43, 0.5);
  backdrop-filter: blur(3px);
}
dialog.native-modal h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
}
dialog.native-modal p {
  font-size: 13.5px;
  color: var(--muted);
  margin-bottom: 16px;
}
dialog.native-modal textarea {
  width: 100%;
  height: 120px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--canvas);
  color: var(--ink);
  resize: vertical;
  box-sizing: border-box;
  margin-bottom: 20px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
</head>
<body>
<main>
  <header class="gate-header">
    <div class="header-top">
      <h1 class="header-title">
        ${esc(title)}
        <span id="status-pill" class="status-pill waiting">Waiting Approval</span>
      </h1>
    </div>
    <p class="status-desc" id="status-desc">Review the plan and documents below. You can select any text to attach inline annotations or request changes.</p>
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div class="actions">
        <button id="approve" class="btn btn-approve">Approve this revision</button>
        <button id="changes" class="btn btn-changes">Request changes</button>
        <button id="cancel" class="btn btn-cancel">Cancel run</button>
      </div>
      <div id="notes-badge" style="font-size: 13px; font-weight: 600; color: var(--muted); background: var(--canvas); padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line);">
        📝 <span id="notes-count">0</span> inline annotations
      </div>
    </div>
  </header>

  <section class="review-content">
    <div class="review-header">
      <h2 id="view-title" class="review-title">Document View</h2>
      <div class="tabs-nav" id="tabs-container"></div>
    </div>
    <iframe id="frame" sandbox="allow-scripts allow-same-origin allow-forms" title="Document viewer"></iframe>
  </section>

  <section class="feedback-box">
    <h3>Feedback &amp; Inline Annotations</h3>
    <p>Select any text in the document above to leave inline notes, or add an overall comment below:</p>
    <div id="notes" class="notes-list"></div>
    <label style="font-weight: 600; font-size: 13px;">
      Decision comment
      <textarea id="comment" maxlength="8000" placeholder="Optional notes or rationale to accompany your decision..."></textarea>
    </label>
  </section>
</main>

<!-- Native HTML Modal for Request Changes -->
<dialog id="modal-changes" class="native-modal">
  <h3>Request Changes</h3>
  <p>Specify what changes are needed before this plan or work can proceed. Your feedback will be returned to the agent.</p>
  <textarea id="modal-comment" placeholder="Describe the required changes or corrections..."></textarea>
  <div class="modal-actions">
    <button type="button" class="btn btn-cancel" onclick="$('modal-changes').close()">Cancel</button>
    <button type="button" class="btn btn-changes" onclick="submitChangesModal()">Submit Changes Request</button>
  </div>
</dialog>

<script>
const $ = s => document.getElementById(s);
const frame = $('frame');
let currentView = 'plan';
let state = { notes: [] };

async function fetchState() {
  const r = await fetch('/api/state');
  state = await r.json();
  renderNotes();
  return state;
}

function updateTabs(st) {
  const container = $('tabs-container');
  container.replaceChildren();

  const addTab = (id, label) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (currentView === id ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => {
      currentView = id;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      frame.src = '/doc/' + id;
    };
    container.appendChild(btn);
  };

  if (st.hasPlan) addTab('plan', 'Plan Artifact');
  for (const doc of st.documents || []) {
    addTab(doc.id, doc.title);
  }
  if (st.hasResults) addTab('results', 'Results Summary');

  frame.src = '/doc/' + currentView;
}

function renderNotes() {
  const c = $('notes');
  const countEl = $('notes-count');
  if (countEl) countEl.textContent = state.notes ? state.notes.length : '0';
  c.replaceChildren();
  if (!state.notes || state.notes.length === 0) {
    c.innerHTML = '<p class="muted" style="font-style: italic; font-size: 13px;">No inline notes yet. Select text anywhere in the document to attach a note, question, or change request.</p>';
    return;
  }
  for (const n of state.notes || []) {
    const item = document.createElement('div');
    item.className = 'note-item';
    const kind = document.createElement('span');
    kind.className = 'note-kind';
    kind.textContent = n.kind || 'note';
    item.appendChild(kind);
    if (n.anchor?.quote) {
      const q = document.createElement('i');
      q.style.color = 'var(--muted)';
      q.style.marginRight = '8px';
      q.textContent = '"' + n.anchor.quote.slice(0, 45) + '..." ';
      item.appendChild(q);
    }
    item.appendChild(document.createTextNode(n.text));
    c.appendChild(item);
  }
}

async function sendDecision(decision, commentText) {
  $('approve').disabled = true;
  $('changes').disabled = true;
  $('cancel').disabled = true;
  const pill = $('status-pill');
  pill.textContent = decision === 'approve' ? 'Approved' : 'Changes Requested';
  pill.className = 'status-pill ' + (decision === 'approve' ? 'approved' : 'rejected');
  $('status-desc').textContent = decision === 'approve' ? 'Approved! Resuming workflow execution...' : 'Changes requested. Returning feedback to agent...';

  await fetch('/api/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision,
      comment: commentText || $('comment').value,
      notes: state.notes
    })
  });
}

$('approve').onclick = () => sendDecision('approve', $('comment').value);

$('changes').onclick = () => {
  $('modal-comment').value = $('comment').value;
  $('modal-changes').showModal();
  $('modal-comment').focus();
};

function submitChangesModal() {
  const comment = $('modal-comment').value;
  $('modal-changes').close();
  sendDecision('changes', comment);
}

$('cancel').onclick = () => sendDecision('cancel', 'Cancelled by reviewer');

// Poll state periodically so notes created inside the iframe appear in the outer list
setInterval(() => {
  fetchState().catch(() => {});
}, 1500);

fetchState().then(st => updateTabs(st));
</script>
</body>
</html>`;
}

export function startReviewGateServer(
  root: string,
  options: ReviewGateOptions,
  onDecision: (decision: string, comment?: string, notes?: Note[]) => void
): Promise<{ port: number; url: string; close: () => void }> {
  return new Promise((res) => {
    const title = options.title || 'Review Gate';
    const planPath = options.plan ? resolve(root, options.plan) : '';
    const hasPlan = planPath && existsSync(planPath);

    const docs = (options.documents || []).map((docPath, i) => {
      const full = resolve(root, docPath);
      return { id: `doc-${i}`, title: basename(docPath), path: full, exists: existsSync(full) };
    });

    const notes: Note[] = [];

    const server: Server = createServer((req, resIncoming) => {
      const url = new URL(req.url || '/', `http://127.0.0.1`);

      if (url.pathname === '/' && req.method === 'GET') {
        resIncoming.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resIncoming.end(shell(root, title));
        return;
      }

      if (url.pathname === '/api/state' && req.method === 'GET') {
        resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
        resIncoming.end(JSON.stringify({
          title,
          hasPlan,
          hasResults: Boolean(options.results),
          documents: docs.map(d => ({ id: d.id, title: d.title })),
          notes
        }));
        return;
      }

      // annotate.js API endpoints
      if (url.pathname === '/notes' && req.method === 'GET') {
        resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
        resIncoming.end(JSON.stringify({
          artifact: 'review.html',
          slug: 'review',
          notes: notes.map(n => ({ ...n, status: n.status || 'open', replies: [] }))
        }));
        return;
      }

      if (url.pathname === '/notes' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const newNote: Note = {
              id: 'note-' + Date.now(),
              kind: data.kind || 'note',
              text: data.text || '',
              anchor: data.anchor,
              created: new Date().toISOString(),
              status: 'open'
            };
            notes.push(newNote);
            resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
            resIncoming.end(JSON.stringify(newNote));
          } catch {
            resIncoming.writeHead(400).end('Bad JSON');
          }
        });
        return;
      }

      if (url.pathname.startsWith('/notes/') && req.method === 'PATCH') {
        const noteId = url.pathname.slice(7);
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const n = notes.find(x => x.id === noteId);
            if (n && data.status) n.status = data.status;
            resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
            resIncoming.end(JSON.stringify({ ok: true }));
          } catch {
            resIncoming.writeHead(400).end('Bad JSON');
          }
        });
        return;
      }

      if (url.pathname.startsWith('/notes/') && req.method === 'DELETE') {
        const noteId = url.pathname.slice(7);
        const idx = notes.findIndex(x => x.id === noteId);
        if (idx >= 0) notes.splice(idx, 1);
        resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
        resIncoming.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === '/peers' && req.method === 'GET') {
        resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
        resIncoming.end(JSON.stringify({ peers: [] }));
        return;
      }

      if (url.pathname === '/version' && req.method === 'GET') {
        resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
        resIncoming.end(JSON.stringify({ version: '1.0' }));
        return;
      }

      if (url.pathname.startsWith('/doc/') && req.method === 'GET') {
        const viewId = url.pathname.slice(5);
        let content = '';

        if (viewId === 'plan' && hasPlan) {
          content = readFileSync(planPath, 'utf8');
          content = annotated(root, content, 'plan');
        } else if (viewId === 'results' && options.results) {
          const resJson = typeof options.results === 'string' ? options.results : JSON.stringify(options.results, null, 2);
          const rawHtml = `<section><h2>Execution Results</h2><pre><code>${esc(resJson)}</code></pre></section>`;
          content = annotated(root, renderMarkdownDoc(root, 'Results Summary', rawHtml), 'results');
        } else {
          const doc = docs.find(d => d.id === viewId);
          if (doc && doc.exists) {
            const raw = readFileSync(doc.path, 'utf8');
            content = doc.path.endsWith('.md') ? renderMarkdownDoc(root, doc.title, raw) : raw;
            content = annotated(root, content, doc.id);
          }
        }

        resIncoming.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resIncoming.end(content || '<p>Document not available</p>');
        return;
      }

      if (url.pathname === '/api/decision' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            onDecision(data.decision, data.comment, notes);
            resIncoming.writeHead(200, { 'Content-Type': 'application/json' });
            resIncoming.end(JSON.stringify({ ok: true }));
          } catch {
            resIncoming.writeHead(400).end('Bad JSON');
          }
        });
        return;
      }

      resIncoming.writeHead(404).end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      res({
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => server.close()
      });
    });
  });
}

export interface ReviewGateResult {
  approved: boolean;
  decision: 'approve' | 'changes' | 'cancel';
  comment: string;
  notes: Note[];
}

// Global references captured during extension initialization
let latestPiInstance: ExtensionAPI | undefined;
let capturedWorkflowRespond: any;
let latestExtensionContext: ExtensionContext | undefined;

// Register reviewGate function with Extensible Workflows
export const reviewGate = workflows?.defineWorkflowFunction({
  description: 'Display an interactive HTML plan or work review in the browser and wait for human approval',
  input: Type.Object({
    plan: Type.Optional(Type.String({ description: 'Path to HTML plan or review artifact' })),
    title: Type.Optional(Type.String({ description: 'Review title' })),
    documents: Type.Optional(Type.Array(Type.String(), { description: 'Additional document paths to display as tabs' })),
    results: Type.Optional(Type.Any({ description: 'Execution results or summary data' }))
  }),
  output: Type.Object({
    approved: Type.Boolean({ description: 'True if approved, false if rejected or changes requested' }),
    decision: Type.String({ description: 'Review decision: approve, changes, or cancel' }),
    comment: Type.String({ description: 'Decision comment or explanation' }),
    notes: Type.Array(Type.Any(), { description: 'Inline annotations created in the review gate' })
  }),
  async run({ plan, title, documents, results }, context) {
    const root = context.run.cwd;
    const runId = context.run.runId;
    let serverHandle: Awaited<ReturnType<typeof startReviewGateServer>> | undefined;

    return new Promise<ReviewGateResult>((resolveOutcome) => {
      startReviewGateServer(root, { plan, title, documents, results, runId }, (decision, comment, notes) => {
        const approved = decision === 'approve';
        const gateResult: ReviewGateResult = {
          approved,
          decision: decision as any,
          comment: comment || '',
          notes: notes || []
        };

        // 1. Durably persist feedback to .pi/reviews/<runId>-<gateSlug>-feedback.json
        try {
          const reviewsDir = join(root, '.pi/reviews');
          if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });
          const gateSlug = (title || 'gate').toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const feedbackPath = join(reviewsDir, `${runId || Date.now()}-${gateSlug}-feedback.json`);
          writeFileSync(feedbackPath, JSON.stringify(gateResult, null, 2), 'utf8');

          // Also append to per-run history array so both plan and work decisions are preserved
          if (runId) {
            const historyPath = join(reviewsDir, `${runId}-history.json`);
            let history: any[] = [];
            if (existsSync(historyPath)) {
              try { history = JSON.parse(readFileSync(historyPath, 'utf8')); } catch {}
            }
            history.push({ gate: gateSlug, title, at: new Date().toISOString(), ...gateResult });
            writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
          }
        } catch (e) {
          console.error('Failed to write review feedback file:', e);
        }

        // 2. Deliver rich notification via Pi so originating session receives notes and comments!
        if (latestPiInstance) {
          const notesText = (gateResult.notes || []).length
            ? `\n\nInline notes (${gateResult.notes.length}):\n` + gateResult.notes.map(n => `• [${n.kind.toUpperCase()}] ${n.anchor?.file ? `${n.anchor.file}${n.anchor.line ? ':' + n.anchor.line : ''} ` : ''}${n.anchor?.quote ? `"${n.anchor.quote}" → ` : ''}${n.text}`).join('\n')
            : '';
          const content = `HTML Review Gate: ${decision.toUpperCase()} for "${title || 'artifact'}".\nComment: ${comment || '(none)'}${notesText}`;

          latestPiInstance.sendMessage({
            customType: 'review-gate-feedback',
            display: true,
            content
          }, { triggerTurn: !approved, deliverAs: !approved ? 'followUp' : 'nextTurn' });
        }

        // Keep server alive briefly so browser shows approved status, then close
        setTimeout(() => serverHandle?.close(), 2000);
        resolveOutcome(gateResult);
      }).then(h => {
        serverHandle = h;
        // Spawns browser open to the review URL
        spawn('open', [h.url], { stdio: 'ignore' }).on('error', () => {});
      });
    });
  }
});

// Export as a native Pi extension
export default function reviewGateExtension(pi: ExtensionAPI) {
  // Register on every load cycle, including when Pi reuses a cached module.
  if (workflows && reviewGate) workflows.registerWorkflowExtension({
    source: import.meta.url,
    version: '1.1.0',
    headline: 'Interactive HTML Review Gate (structured feedback)',
    functions: { reviewGate }
  });
  latestPiInstance = pi;
  // Capture workflow_respond tool when Extensible Workflows registers it
  const origRegisterTool = pi.registerTool.bind(pi);
  pi.registerTool = function (toolDef: any) {
    if (toolDef.name === 'workflow_respond') {
      capturedWorkflowRespond = toolDef;
    }
    return origRegisterTool(toolDef);
  };

  // Capture context on session events
  pi.on('session_start', (_e, ctx) => {
    latestExtensionContext = ctx;
  });

  // Expose review_gate as a standalone tool
  pi.registerTool({
    name: 'review_gate',
    label: 'HTML Review Gate',
    description: 'Display an interactive HTML plan or work review in the browser and wait for human approval',
    parameters: Type.Object({
      plan: Type.Optional(Type.String({ description: 'Relative path to HTML artifact' })),
      title: Type.Optional(Type.String({ description: 'Review title' })),
      documents: Type.Optional(Type.Array(Type.String(), { description: 'Additional document paths' })),
      results: Type.Optional(Type.Any({ description: 'Execution results or summary' }))
    }),
    async execute(_id, params, _signal, _onUpdate, ctx: ExtensionContext) {
      latestExtensionContext = ctx;
      const root = ctx.cwd;
      const decision = await new Promise<{ approved: boolean; comment?: string; notes?: Note[] }>((resolveDecision) => {
        startReviewGateServer(root, params, (dec, comment, notes) => {
          resolveDecision({ approved: dec === 'approve', comment, notes });
        }).then(h => {
          spawn('open', [h.url], { stdio: 'ignore' }).on('error', () => {});
        });
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Review decision: ${decision.approved ? 'APPROVED' : 'CHANGES REQUESTED'}${decision.comment ? `\nComment: ${decision.comment}` : ''}${decision.notes?.length ? `\nNotes: ${JSON.stringify(decision.notes)}` : ''}`
        }],
        details: decision
      };
    }
  });
}
