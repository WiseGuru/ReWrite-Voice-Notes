---
name: release-checklist
description: Run the ReWrite (Voice Notes) plugin's pre-release verification. Use before tagging a release, or when the user asks to smoke-test / verify the plugin in a real vault. Automates the build-and-install-into-a-scratch-vault step, then walks the feature-by-feature CHECKLIST.md so the human effort goes into clicking through features rather than copying files.
---

# Release checklist

This plugin has no headless UI test harness, so event-wiring and UI-lifecycle bugs are invisible to `npm run build` / `npm run lint` / `npm test`. This skill closes that gap: it installs a fresh build into a scratch Obsidian vault, then drives a human through a feature-by-feature manual pass.

It is the successor to the stale "Testing Checklist" in `obsidian-voice-notes-spec.md` and the token "manual smoke test" step in `docs/RELEASING.md`. See `docs/DEV_TOOLING.md` for how the automated portion works.

## Phase 1 — Setup check

1. Confirm `dev-tools.config.json` exists at the repo root with a non-empty `releaseVault.vaultPath`. If not, tell the user to copy `dev-tools.config.example.json` to `dev-tools.config.json` and fill in `releaseVault.vaultPath` (a **scratch** vault, never a real personal one). Do not proceed without it.
2. Confirm the working tree is in the state the user intends to ship (everything they want tested is saved/committed).

## Phase 2 — Build and install (automated)

Run the release-prep script via Bash:

```bash
npm run release:prep
```

This runs `npm run build`, then copies `main.js` / `manifest.json` / `styles.css` into `<vaultPath>/.obsidian/plugins/rewrite-voice-notes/`. It fails loudly (non-zero exit) on a build error or a bad vault path; surface any failure to the user and stop.

Then tell the user to open that scratch vault in Obsidian and reload the plugin (Settings -> Community plugins -> toggle it off and on, or reload Obsidian), and confirm it loads with no errors in the developer console. **A clean load is itself the first checklist item** — it is the exact step that would have caught the regression that motivated this tooling.

## Phase 3 — Feature pass (human-driven)

Open `CHECKLIST.md` (in this skill folder) and walk it area by area. For each item, ask the user to perform the action in the scratch vault and report the result; record PASS / FAIL / SKIP and any notes on the `Result: ____` line.

- Scope the pass to what changed when the user only touched part of the plugin, but always include the "Core" area and a clean-load check.
- On any FAIL, capture the exact symptom (and console output if any) — that is the finding, not "it broke."
- `CHECKLIST.md` is also runnable standalone by a human with no Claude Code; keep it self-contained prose.

## Phase 4 — Summary

Save the filled-out run to `docs/claude-scratch/release-checklist-<version>.md` (read `<version>` from `manifest.json`; that folder is gitignored). Then give a clear **go / no-go**: list every FAIL with its symptom, note any SKIP and why, and state plainly whether the build is releasable. Do not soften a FAIL into a pass.
