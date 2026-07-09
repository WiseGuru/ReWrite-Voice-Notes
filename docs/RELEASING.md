# Releasing ReWrite (Voice Notes)

How to cut a new release the Obsidian way, without tripping the community-plugin review. Read this before every release.

Releases are automated by [.github/workflows/release.yml](../.github/workflows/release.yml): pushing a version tag builds the bundle, attaches build-provenance attestations, and publishes the GitHub release. Your job is the version bump, the pre-flight checks, and pushing a correctly named tag.

## TL;DR

```bash
# 0. On master, clean working tree, everything you want shipped is committed.
npm run build && npm run lint          # must both pass
# 0a. Roll docs/ROADMAP.md: move the Unreleased items into a new
#     "### <version> — <YYYY-MM-DD>" block under Released, leave Unreleased empty.
# 1. Bump version files (no auto commit/tag so we control the message)
npm version patch --no-git-tag-version # or minor / major
# 2. Commit the bump (include the rolled roadmap)
git add manifest.json package.json package-lock.json versions.json docs/ROADMAP.md
git commit -m "1.0.1"                  # use the new version as the subject
# 3. Tag with the BARE version (no leading v) and push
git tag -a 1.0.1 -m "Release 1.0.1"
git push origin master
git push origin 1.0.1
# 4. Watch CI, then verify provenance (see Verify below)
```

The tag name must equal `manifest.json`'s `version` exactly. `.npmrc` already pins `tag-version-prefix=""`, so `npm version` produces a bare tag too if you ever let it tag directly.

## Hard rules (Obsidian requirements)

- **No `v` in the tag.** The release tag must match `manifest.json` `version` character-for-character: `1.0.1`, never `v1.0.1`.
- **Three loose asset files.** `main.js`, `manifest.json`, `styles.css` attached as individual binary assets, never zipped. The workflow does this; do not hand-upload.
- **A new release needs a new version number.** Obsidian's automated review only registers a change when the version increments. Re-pushing the same version does not count as a new submission. Bump the patch/minor/major rather than overwriting a published version. (To address review feedback, update the repo and publish a new GitHub release with an incremented version.)
- **Version format is `x.y.z` only.** Semantic Versioning, no pre-release suffixes (no `1.0.0-beta`, no build metadata). The initial release is `1.0.0`.
- **The directory reads `manifest.json` at the HEAD of your default branch** (`master`), not just the release asset. Keep master's `manifest.json` correct and in sync with the released version.
- **`minAppVersion` must be >= the highest `@since` of every Obsidian API you call directly** (anything not behind a runtime feature-detect). Check `node_modules/obsidian/obsidian.d.ts` for the `@since` of new APIs. Example from this project: `FileManager.trashFile` is `@since 1.6.6`, which is why `minAppVersion` is `1.6.6` (raised from 1.4.4, which `FileManager.processFrontMatter` `@since 1.4.4` had driven). The `obsidianmd/no-unsupported-api` lint rule flags a direct call newer than the declared floor. Feature-detected APIs (like `app.secretStorage`) do not raise the floor.
- **`versions.json` maps plugin version -> minAppVersion.** Our [version-bump.mjs](../version-bump.mjs) only adds a new line when the `minAppVersion` value is not already present (i.e. when the floor actually changes). That is valid: Obsidian reads the latest version straight from the release `manifest.json`, and consults `versions.json` only to find the newest plugin version compatible with an older app. If you raise `minAppVersion`, confirm a new `versions.json` entry was written; if you keep it, no new line is expected.
- **Public repo + LICENSE.** The repo must be public to be listed, with a real LICENSE whose copyright holder is correct (this plugin is 0BSD). The README must disclose network use, and `manifest.json` carries `author`, `authorUrl`, and (if you take donations) `fundingUrl`.

## Pre-flight checklist

1. `npm run build` passes (this is `tsc -noEmit` then esbuild production; a type error here is a release blocker).
2. `npm run lint` passes with zero warnings, and `npm test` passes. The local `eslint-plugin-obsidianmd` is looser than the official review bot, so also eyeball the conflict checklist below.
3. Manual feature pass via the **`release-checklist` skill** (`.claude/skills/release-checklist/`), which sequences the whole verification. Its Phase 1 runs the automated pre-checks (`build` / `lint` / `test` plus the advisory `npm run review` and `npm run review:docs` local reviews); then `npm run release:prep` builds and installs `main.js` / `manifest.json` / `styles.css` into your test vault's `.obsidian/plugins/rewrite-voice-notes/` (configure `releaseVault.vaultPath` in `dev-tools.config.json` first — `release:prep` only overwrites those three files, so a vault with real data is safe); then the skill walks `CHECKLIST.md` feature by feature. `CHECKLIST.md` is also runnable standalone by a human without Claude Code. See [DEV_TOOLING.md](DEV_TOOLING.md). Test the actual **versioned** artifact: bump first (`npm version <patch|minor|major> --no-git-tag-version`), then run the pass, then commit + tag.
4. Update docs for any behavioral change ([CLAUDE.md](../CLAUDE.md), the user-facing [`wiki/`](../wiki/) pages, and the [README](../README.md)), per the doc-maintenance rules in CLAUDE.md.
5. Roll [ROADMAP.md](ROADMAP.md): every item shipping in this release should already have an **Unreleased** entry. Move them into a new `### <version> — <YYYY-MM-DD>` heading at the top of the **Released** archive, and leave `## Unreleased` empty for the next cycle. The version + date must match the tag.

## Guideline-conflict checklist (what the review bot flags)

These are the recurring findings; clear them before tagging. Most are also why the items above exist.

**Local lint now mirrors the bot for the classes that previously slipped through** (the 1.2.0 submission failed on three the local lint did not catch). [eslint.config.mts](../eslint.config.mts) enables: the type-checked `@typescript-eslint` rules (`no-deprecated`, the `no-unsafe-*` family, `no-unnecessary-type-assertion`); `no-unsupported-api` (cherry-picked from a `0.4.1` alias of `eslint-plugin-obsidianmd` since our pinned `0.1.9` base lacks it) so a direct Obsidian API newer than `minAppVersion` is caught locally; and `noInlineConfig` so an `eslint-disable` can never silence a rule. So `npm run lint` failing on these now is the point. When the review bot adds a new rule class we do not catch, add it here the same way (prefer cherry-picking one rule from the alias over adopting `0.4.x`'s recommended config wholesale, whose `ui/sentence-case` is over-aggressive and diverges from the bot).

- **Plugin `id`**: lowercase letters and hyphens only, must not end in `plugin`, must not contain `obsidian`. Locked once published; do not change it. (Ours is `rewrite-voice-notes`.)
- **No newer-than-minAppVersion APIs**: see the `minAppVersion` rule above. Enforced locally by `obsidianmd-latest/no-unsupported-api`.
- **No `eslint-disable` directives.** The bot rejects disabling its rules, and `noInlineConfig` makes them inert locally (an attempt to suppress an error just leaves the error). Reach APIs outside the typed/deprecated surface through local type-aliases instead (see [src/realtime/pcm.ts](../src/realtime/pcm.ts)'s `ScriptProcessorNodeLike`). If a string trips `ui/sentence-case` (e.g. a random example), pass it through a variable instead of a string literal; the rule only inspects literals.
- **Popout-window safety**: use `activeDocument` / `activeWindow` instead of `document` / `window`-as-globalThis where a popout could differ; use `window.setTimeout` / `window.clearTimeout` (not bare `setTimeout`); avoid `globalThis` (use `window`). For paired `addEventListener` / `removeEventListener`, capture one document reference so removal targets the same object.
- **No `!important` in [styles.css](../styles.css).** Raise specificity, use CSS variables, or toggle via Obsidian's `el.toggle()` / `hide()` / `show()` (which set inline display) instead.
- **Manifest `description`**: action-focused, <= 250 chars, ends with a period, no emoji.
- **Build provenance**: leave releases to CI so the attestation is generated; hand-uploaded assets are unattested.
- **Deferred by choice** (document, do not silently regress): the `display()` -> `getSettingDefinitions` settings migration (needs minAppVersion 1.13.0+, deferred) and full-vault enumeration (`getFiles` for audio collection is necessary and disclosed in the README "Vault access" section).

See [DEVCONFLICTS.md](DEVCONFLICTS.md) for the full history of conflicts found and how each was resolved or accepted.

## What the CI workflow does

On any pushed tag, [.github/workflows/release.yml](../.github/workflows/release.yml):

1. checks out, sets up Node 20, `npm ci`,
2. `npm run build` (produces `main.js`; `manifest.json` and `styles.css` are already in the repo),
3. `actions/attest-build-provenance@v2` over the three assets (cryptographic provenance proving they were built from source),
4. `softprops/action-gh-release@v2` publishes/updates the release for that tag with the three assets.

It runs with `permissions: contents: write, id-token: write, attestations: write`. If you ever change the workflow, keep all three permissions or attestation fails. The workflow also relies on the repo allowing Actions to write: **Settings -> Actions -> General -> Workflow permissions -> Read and write permissions** must be enabled (the per-job `permissions` block sets the token scopes, but the repo-level toggle must also permit it).

**Difference from Obsidian's sample workflow.** The official guide ([Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)) uses the GitHub CLI to create a **draft** release that you publish manually after adding notes:

```bash
gh release create "$tag" --title="$tag" --draft main.js manifest.json styles.css
```

Ours intentionally diverges: it **auto-publishes** (no manual step) and **adds build-provenance attestations**, which the sample does not. If you ever want the draft-and-review-notes flow instead, switch the publish step back to the `gh release create ... --draft` form, but you then lose attestation unless you keep the attest step.

## Verify (after pushing the tag)

```bash
gh run watch <run-id> --repo WiseGuru/ReWrite-Voice-Notes --exit-status   # must exit 0
# Provenance check against the published asset:
gh release download 1.0.1 --repo WiseGuru/ReWrite-Voice-Notes --dir /tmp/rel --clobber
gh attestation verify /tmp/rel/main.js --repo WiseGuru/ReWrite-Voice-Notes # must exit 0
```

Also confirm the release page shows the bare tag (`1.0.1`, no `v`) and all three assets.

## Re-releasing the same version (rare)

Only for fixing a botched release that nobody has consumed, and never once the version is accepted/depended on. Move the tag to the new commit and force-push to re-trigger CI:

```bash
git tag -d 1.0.1 && git tag -a 1.0.1 -m "Release 1.0.1"
git push origin 1.0.1 --force
```

For anything the community review should notice, cut a new version instead.

## Submitting to the community list (first time only)

Prerequisites: a public repo containing `README.md`, `LICENSE`, and `manifest.json`, plus at least one published GitHub release whose tag matches the manifest version and carries `main.js` / `manifest.json` / `styles.css`.

The documented path is the web form, not a manual `community-plugins.json` PR:

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account.
2. Link your GitHub account to your profile.
3. **Plugins -> New plugin**, enter your repository URL.
4. Agree to the Developer policies, then **Submit**.

Notes:

- The directory processes the `manifest.json` at the **HEAD of your default branch**, so master must be correct.
- The `id` must be unique across all published plugins and must not contain `obsidian` (and, per the manifest rules, must not end in `plugin`).
- When a user installs, Obsidian downloads `main.js`, `manifest.json`, and `styles.css` from the GitHub release.
- An automated reviewer runs the checks in the conflict checklist above. To address feedback, update the repo and publish a new GitHub release with an incremented version (do not reuse a version).

## Submission requirements (verify before submitting)

From [Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins):

- **Remove all sample/template code** (leftover from `obsidian-sample-plugin`); rename placeholder classes.
- **Command IDs must not include the plugin id** (Obsidian auto-prefixes them with the id).
- **`isDesktopOnly: true`** if the plugin uses Node.js/Electron APIs (`fs`, `crypto`, `os`, `child_process`, etc.). We keep it `false` and lazy-load Node modules only behind `Platform.isDesktop` for the desktop-only whisper host, which is the accepted mixed pattern but is worth re-justifying each review.
- **`description`**: action-focused (not "This is a plugin..."), <= 250 chars, ends with a period, no emoji, correct casing for brands/acronyms.
- **`fundingUrl`**: include only if you actually accept donations.
- **`minAppVersion`**: a real minimum; if unsure, the latest stable build.

## Broader plugin guidelines (continuous, re-check before release)

From [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines). Most are already satisfied; treat this as a regression guard for new code:

- Use `this.app`, never the global `app` / `window.app`. Keep console output to errors only.
- Settings tab: no top-level/plugin-name heading, no the word "settings" in section names, use `setHeading()` (we wrap this in `sectionHeading()`).
- DOM: never `innerHTML` / `outerHTML` / `insertAdjacentHTML`; build with `createEl` / `createDiv` / `createSpan`; clear with `el.empty()`.
- Clean up on unload via `registerEvent` / `registerInterval` / `registerDomEvent`; do not detach leaves in `onunload`.
- Commands: no default hotkeys; `callback` vs `checkCallback` vs `editorCheckCallback` chosen to match whether the command needs an editor.
- Workspace/vault: `getActiveViewOfType(MarkdownView)` over `activeLeaf`; `Vault.process` over `Vault.modify` for background read-modify-write (Editor API for the active file); `FileManager.processFrontMatter` for frontmatter; prefer `app.vault` over `app.vault.adapter` except for plugin-config files; `getFileByPath` / `getAbstractFileByPath` over iterating; `normalizePath` on all constructed paths.
- Styling: no hardcoded `el.style`, no `!important`; use CSS classes + Obsidian CSS variables (`--text-muted`, etc.).
- Mobile/popout: avoid Node/Electron APIs on mobile; avoid lookbehind in regexes; use `activeDocument` / `activeWindow` and `window.setTimeout` for popout-window safety (avoid bare `globalThis`).
- TypeScript: `const` / `let` (no `var`), `async` / `await` over raw Promise chains.

## Canonical Obsidian docs

- [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
