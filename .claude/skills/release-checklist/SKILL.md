---
name: release-checklist
description: Run the ReWrite (Voice Notes) plugin's release verification. Use before cutting a stable release, or when the user asks to smoke-test / verify the plugin in a real vault. Runs the automated pre-checks (build, lint, test, and the advisory local reviews), installs the published -alpha/-beta prerelease artifact (or a fresh local build when no prerelease exists yet) into a test vault, then walks the feature-by-feature CHECKLIST.md so the human effort goes into clicking through features rather than copying files.
---

# Release checklist

This plugin has no headless UI test harness, so event-wiring and UI-lifecycle bugs are invisible to `npm run build` / `npm run lint` / `npm test`. This skill closes that gap: it runs every automated check available, installs the artifact under test into a test Obsidian vault (the published `-alpha`/`-beta` prerelease for a release gate; a fresh local build for mid-development iteration), then drives a human through a feature-by-feature manual pass.

It is the successor to the stale "Testing Checklist" in `obsidian-voice-notes-spec.md` and the token "manual smoke test" step in `docs/RELEASING.md`. The mechanics of each tool are in `docs/DEV_TOOLING.md`; the tag/push release steps are in `docs/RELEASING.md`. This skill is the front door that sequences them.

## Phase 1 — Automated pre-checks

Run all of these first; they are cheap and catch the machine-checkable problems before a human spends time clicking:

```bash
npm run build && npm run lint && npm test    # CI parity — must all pass
npm run review        # advisory local code review of the working-tree diff
npm run review:docs   # advisory local doc-consistency review
```

- `build`/`lint`/`test` are release blockers if they fail. `npm run lint` is configured to mirror the Obsidian community-review bot for the classes that previously slipped through to submission: the type-checked `@typescript-eslint` rules (`no-deprecated` / `no-unsafe-*` / `no-unnecessary-type-assertion`), `no-unsupported-api` (an Obsidian API newer than `manifest.json`'s `minAppVersion`), and `noInlineConfig` (an `eslint-disable` can no longer silence a rule). If lint fails on one of these, it is doing its job; do not work around it with a disable comment. See RELEASING.md's guideline-conflict checklist.
- The two `review` runs are **advisory** (always exit 0). Read the reports in `docs/claude-scratch/local-review-<mode>-report.md` and surface anything real. They will not block, and they are imperfect (local, quantized model), so treat findings as a first-pass filter, not a gate.
- **If a review report says "(no findings returned)" or looks empty/garbled**, it is almost always a model/tooling issue, not a clean bill of health — see `docs/DEV_TOOLING.md` Gotchas (reasoning models need thinking disabled; the context must fit the prompt; a huge diff truncates). Fix the tooling or note it; do not read empty output as "no problems."

## Phase 2 — Setup check

1. Confirm `dev-tools.config.json` exists at the repo root with a non-empty `releaseVault.vaultPath`. If not, tell the user to copy `dev-tools.config.example.json` to `dev-tools.config.json` and fill it in. A dedicated **scratch** vault is ideal; a real vault is acceptable because the install only overwrites the three build artifacts (see Phase 3), but never point it anywhere you'd mind a plugin reload.
2. Confirm the working tree holds exactly what the user intends to ship, and that master carries **no version bump**: per `docs/RELEASING.md`, all testing happens on published `-alpha`/`-beta` prerelease artifacts while `manifest.json` stays at the last stable version. The bump + bare tag come only after this skill's go decision.
3. Identify the prerelease to test: the newest `-alpha`/`-beta` tag whose commit matches what the user intends to ship (`gh release list`). If the tree has moved past the latest prerelease, cut a new suffixed tag first (see RELEASING.md) — do not sign off on an artifact that doesn't match master.

## Phase 3 — Install the artifact under test

**Release gate (a prerelease exists):** install the published, attested prerelease assets into the vault — that exact build is what the stable release will re-version:

```bash
gh release download <tag> --repo WiseGuru/ReWrite-Voice-Notes --clobber \
  --dir "<vaultPath>/.obsidian/plugins/rewrite-voice-notes"
```

**Local iteration (no prerelease yet, or mid-development):** `npm run release:prep` builds the working tree and copies the three files into the same folder. Fine for finding bugs fast; the final pass before a stable tag should still run against the prerelease artifact.

Both paths **only overwrite `main.js` / `manifest.json` / `styles.css`** — `data.json` and `secrets.json.nosync` in the target folder are left untouched, so a re-install keeps the user's settings and keys (this is why running against a vault with real data is safe). `release:prep` fails loudly (non-zero exit) on a build error or a bad vault path; surface any failure and stop.

Then tell the user to open the vault and reload the plugin (Settings -> Community plugins -> toggle it off and on, or reload Obsidian), and confirm it loads with no errors in the developer console. **A clean load is itself the first checklist item** — it is the exact step that would have caught the regression that motivated this tooling.

## Phase 4 — Feature pass (human-driven)

Open `CHECKLIST.md` (in this skill folder) and walk it area by area. For each item, ask the user to perform the action in the vault and report the result; record PASS / FAIL / SKIP and any notes on the `Result: ____` line.

- Scope the pass to what changed when the user only touched part of the plugin, but always include the "Core" area and a clean-load check. Give the newest, least-tested features the most attention.
- On any FAIL, capture the exact symptom (and console output if any) — that is the finding, not "it broke."
- Mobile-only items need a phone; SKIP is fine if the user isn't testing mobile that round.
- `CHECKLIST.md` is also runnable standalone by a human with no Claude Code; keep it self-contained prose, and keep it in sync with the feature set (a feature change updates it in the same commit, like CLAUDE.md and the wiki).

## Phase 5 — Summary and hand-off to release

Save the filled-out run to `docs/claude-scratch/release-checklist-<version>.md` (name it after the tag under test, e.g. `1.3.0-alpha`; when testing a local `release:prep` build instead, use `manifest.json`'s version. The folder is gitignored). Then give a clear **go / no-go**: list every FAIL with its symptom, note any SKIP and why, and state plainly whether the build is releasable. Do not soften a FAIL into a pass.

On a **go**, the actual release (bump `npm version <patch|minor|major> --no-git-tag-version`, commit the bump + rolled `docs/ROADMAP.md`, tag the bare version, push, let CI build the attested assets) follows `docs/RELEASING.md`. The bump commit (plus doc-only commits) is the only permitted delta between the tested prerelease and the stable tag; any artifact-affecting change means a new prerelease round. This skill stops at the go/no-go decision; it does not tag or push.
