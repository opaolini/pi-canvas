// Offline: load this package through pi's real resource loader (no inference, no session hooks).
// Run: node --test test/*.test.mjs   (PI_SDK_ROOT may override the SDK location)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = process.env.PI_SDK_ROOT || join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const { DefaultResourceLoader, getAgentDir } = await import(pathToFileURL(join(sdk, 'dist/index.js')).href);
const realAgentDir = getAgentDir();
const workflowPkg = (() => {
  try { return JSON.parse(readFileSync(join(realAgentDir, 'settings.json'), 'utf8')).packages?.find(p => /pi-extensible-workflows/.test(typeof p === 'string' ? p : p.source)); } catch { return undefined; }
})();

async function load({ withWorkflows }) {
  const fixture = mkdtempSync(join(tmpdir(), 'pi-canvas-load-'));
  const agentDir = join(fixture, 'agent'), cwd = join(fixture, 'project');
  mkdirSync(join(agentDir, 'npm'), { recursive: true }); mkdirSync(cwd);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [pkg, ...(withWorkflows ? [workflowPkg] : [])] }));
  if (withWorkflows) symlinkSync(join(realAgentDir, 'npm/node_modules'), join(agentDir, 'npm/node_modules'), 'dir');
  const old = { dir: process.env.PI_CODING_AGENT_DIR, off: process.env.PI_OFFLINE };
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = '1';
  try {
    const loader = new DefaultResourceLoader({ cwd, agentDir, noContextFiles: true, noThemes: true });
    await loader.reload({ resolveProjectTrust: async () => true });
    const ext = loader.getExtensions();
    return {
      errors: ext.errors,
      tools: ext.extensions.flatMap(e => [...e.tools.keys()]),
      skills: loader.getSkills().skills.map(s => s.name),
      functions: Object.keys(globalThis[Symbol.for('pi-extensible-workflows.workflow-registry')]?.api?.functions?.() ?? {}),
    };
  } finally {
    process.env.PI_CODING_AGENT_DIR = old.dir; process.env.PI_OFFLINE = old.off;
    if (old.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    if (old.off === undefined) delete process.env.PI_OFFLINE;
    rmSync(fixture, { recursive: true, force: true });
  }
}

test('loads standalone: review_gate tool + skills, no errors', async () => {
  const r = await load({ withWorkflows: false });
  assert.deepEqual(r.errors, []);
  assert.ok(r.tools.includes('review_gate'));
  for (const s of ['html-artifact', 'local-review']) assert.ok(r.skills.includes(s), s);
});

test('registers reviewGate workflow function when pi-extensible-workflows is installed', { skip: !workflowPkg && 'pi-extensible-workflows not installed globally' }, async () => {
  const r = await load({ withWorkflows: true });
  assert.deepEqual(r.errors, []);
  assert.ok(r.functions.includes('reviewGate'), r.functions.join(','));
});
