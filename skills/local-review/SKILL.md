---
name: local-review
description: Pre-PR local code review with browser annotations fed back to this session. Use when the user says "prepare a local review", "review this before the PR", "let me review the diff first", or wants to look at a branch before a PR is opened. Renders the branch diff (committed + uncommitted + untracked vs the merge base) as an annotatable artifact; line notes come back via pi-intercom; iterate until approved, then open the PR.
---

# local-review — review the diff before it becomes a PR

`A=../../artifacts/artifact` (relative to this skill directory; resolve to an absolute path).

```
$A review <slug> --repo <path-to-repo> [--base origin/main]   # new artifact, or refresh the Diff section of an existing one
$A check <slug> && $A session <slug> --detach --no-open && $A session <slug> --url   # give the user the URL
```

`<slug>` = `review-<repo>-<branch>` (lowercase, dashes). Base defaults to `origin/main`, else `main`.
Lockfiles, binaries and huge files are listed but not rendered. Nothing is pushed or posted.

## Loop

1. **Self-review first.** Read the actual diff, run the repo's tests/lint. Fill the placeholders
   *outside* the `kb:diff` markers with one edit: Verdict (ready for PR / fix first), Findings
   (severity cards citing `path:line`), Checklist (commands run + result). No findings? Say so and
   drop the example card. Never edit inside the `kb:diff` markers — `review` regenerates them.
2. **Hand over** the session URL, then stop and return control; do not poll.
3. **The user annotates**: select code → ＋ Note, or ⌥-click a diff line. Notes arrive as an
   "Artifact review" message with `` `path:line` `` per note.
4. **Address every note** in the repo (edit code, rerun tests), then:
   - `$A review <slug> --repo <path>` → Diff refreshes, the open page reloads, notes stay.
   - Update Verdict/Findings if they changed; `$A rebuild <slug>` after content edits.
   - `$A reply <slug> <id> "what changed"` for each; `$A resolve <slug> <id>` when done.
5. **Repeat** until the user approves (✅ approve note or in chat).
6. **Then** commit and open the PR (draft unless told otherwise). Posting any comment or review
   on the forge needs the user's explicit consent.

`$A session --stop <slug>` when finished. The artifact and its `.notes.json` are the review record;
keep or delete them as the user prefers.
