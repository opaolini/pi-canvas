/** Annotation sidecar for an artifact: assets/files/<file>.notes.json.
 *  Pure helpers (no I/O except load/save) so the store and the Markdown rendering are testable. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type NoteKind = "question" | "note" | "change" | "approve";
export type Reply = { by: "agent" | "reviewer"; text: string; at: string };
export type Note = {
  id: string;
  kind: NoteKind;
  text: string;
  /** Where the note is anchored. section = id of the nearest <section id>/<h2>; quote = selected text (may be empty for whole-page notes). */
  anchor: { section?: string; heading?: string; quote?: string; selector?: string; element?: string; label?: string; file?: string; line?: string; side?: "old" | "new" };
  created: string;
  status: "open" | "sent" | "answered" | "resolved";
  sentAt?: string;
  replies: Reply[];
};
export type NotesFile = { artifact: string; slug: string; notes: Note[]; updated: string };

export const KIND_ICON: Record<NoteKind, string> = { question: "❓", note: "📝", change: "✏️", approve: "✅" };

export const notesPath = (artifactFile: string) => artifactFile.replace(/\.html$/, ".notes.json");
const now = () => new Date().toISOString();
const newId = () => "n" + Math.random().toString(36).slice(2, 7);

export function loadNotes(artifactFile: string, slug: string): NotesFile {
  const p = notesPath(artifactFile);
  if (!existsSync(p)) return { artifact: artifactFile.split("/").pop()!, slug, notes: [], updated: now() };
  return JSON.parse(readFileSync(p, "utf8"));
}
export function saveNotes(artifactFile: string, data: NotesFile): void {
  data.updated = now();
  writeFileSync(notesPath(artifactFile), JSON.stringify(data, null, 2) + "\n");
}

export function addNote(data: NotesFile, input: { kind: NoteKind; text: string; anchor?: Note["anchor"]; id?: string }): Note {
  const note: Note = { id: input.id ?? newId(), kind: input.kind, text: input.text.trim(), anchor: input.anchor ?? {}, created: now(), status: "open", replies: [] };
  data.notes.push(note);
  return note;
}
export function updateNote(data: NotesFile, id: string, patch: Partial<Pick<Note, "kind" | "text" | "status">>): Note {
  const n = data.notes.find((x) => x.id === id);
  if (!n) throw new Error(`no note ${id}`);
  Object.assign(n, patch);
  return n;
}
export function deleteNote(data: NotesFile, id: string): void {
  const i = data.notes.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no note ${id}`);
  data.notes.splice(i, 1);
}
export function addReply(data: NotesFile, id: string, by: Reply["by"], text: string): Note {
  const n = data.notes.find((x) => x.id === id);
  if (!n) throw new Error(`no note ${id}`);
  n.replies.push({ by, text: text.trim(), at: now() });
  if (by === "agent" && n.status !== "resolved") n.status = "answered";
  return n;
}
export function markSent(data: NotesFile, ids: string[]): void {
  const at = now();
  for (const n of data.notes) if (ids.includes(n.id) && n.status === "open") { n.status = "sent"; n.sentAt = at; }
}
export const unsent = (data: NotesFile) => data.notes.filter((n) => n.status === "open");

/** Markdown the agent receives (intercom message body) or prints with `artifact notes`. */
export function notesToMarkdown(data: NotesFile, notes: Note[] = data.notes, opts: { relPath?: string; header?: boolean } = {}): string {
  const lines: string[] = [];
  if (opts.header !== false) {
    lines.push(`**Artifact review** \`${data.slug}\` — ${notes.length} note${notes.length === 1 ? "" : "s"} from the reviewer (${opts.relPath ?? data.artifact})`, "");
  }
  notes.forEach((n, i) => {
    const target = n.anchor.selector ? `› [${n.anchor.element ?? "element"}] ${n.anchor.label ?? ""}` : n.anchor.quote ? `› “${truncate(n.anchor.quote, 140)}”` : "";
    const loc = n.anchor.file && `\`${n.anchor.file}${n.anchor.line ? ":" + n.anchor.line : ""}\`${n.anchor.side === "old" ? " (removed line)" : ""}`;
    const where = [loc || (n.anchor.heading && `in “${n.anchor.heading}”`), target].filter(Boolean).join(" ");
    lines.push(`${i + 1}. ${KIND_ICON[n.kind]} **${n.kind}** \`${n.id}\`${where ? " " + where : ""}`);
    for (const l of n.text.split("\n")) lines.push(`   > ${l}`);
    for (const r of n.replies) lines.push(`   ↳ *${r.by}* (${r.at.slice(0, 16).replace("T", " ")}): ${r.text}`);
    if (n.status !== "open" && n.status !== "sent") lines.push(`   _status: ${n.status}_`);
  });
  if (opts.header !== false) {
    lines.push("", `Reply: \`artifact reply ${data.slug} <id> "…"\` · resolve: \`artifact resolve ${data.slug} <id>\` · if you change the artifact, \`rebuild\` it — the open page reloads automatically.`);
  }
  return lines.join("\n");
}

/** A complete, portable instruction that can be pasted into Codex when Pi intercom is unavailable.
 * The sidecar stays the source of truth; this is a read-only rendering of it. */
export function notesToCodexPrompt(data: NotesFile, notes: Note[] = data.notes, opts: { relPath?: string; notesPath?: string } = {}): string {
  const artifactPath = opts.relPath ?? data.artifact;
  const sidecarPath = opts.notesPath ?? artifactPath.replace(/\.html$/, ".notes.json");
  const ids = notes.map((n) => `\`${n.id}\``).join(", ") || "(none)";
  return [
    `Review the annotation notes for artifact \`${data.slug}\` at \`${artifactPath}\`.`,
    `The canonical notes file is \`${sidecarPath}\`.`,
    `Address these note IDs: ${ids}.`,
    "For each note, make the requested artifact or supporting-source change when appropriate, then add a reply and resolve it only when complete. Preserve the notes sidecar and its existing replies/statuses. Do not treat this pasted prompt as a delivered Pi message or mark any note as sent.",
    "",
    "Annotation notes:",
    notesToMarkdown(data, notes, { relPath: artifactPath, header: false }),
  ].join("\n");
}
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
