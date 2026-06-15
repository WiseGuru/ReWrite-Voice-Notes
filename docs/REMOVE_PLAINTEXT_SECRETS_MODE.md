# Plan: Remove the plaintext secrets mode; defer SecretStorage to GA

Status: IMPLEMENTED 2026-05-30 (as part of FEATURES.md item 4, alongside keychain verification + Argon2id/entropy hardening). Kept for reference. Captured 2026-05-28.

## Context

The plugin stores per-profile API keys in `secrets.json.nosync` via [src/secrets.ts](../src/secrets.ts) using three encryption modes: `safeStorage` (OS keychain), `passphrase` (AES-GCM/PBKDF2), and `plaintext` (no encryption). Plaintext exists only as the zero-config auto-fallback on devices without an OS keychain (mobile, Linux-without-keyring).

The original idea was to swap plaintext for Obsidian's new SecretStorage API. Investigation found SecretStorage (`app.secretStorage.getSecret/setSecret/listSecrets`, plus `SecretComponent`) only shipped in **Obsidian 1.11.4** (Jan 2026, desktop early-access). It is not in the installed typings (1.10.3), `minAppVersion` is `1.4.0`, and 1.11.x is not yet on npm `latest`.

Decisions taken:
- **Remove the plaintext mode entirely now.** No unencrypted at-rest option should exist.
- **Defer SecretStorage** until it reaches GA (and lands on mobile). Record it as future work rather than building against an early-access API.

**Behavioral consequence (intended, accepted):** after this change, a device with no OS keychain has no zero-config store. First-run on such a device requires the user to set a passphrase before any API key can be saved. This is the main UX shift and the reason the change is more than a one-line deletion.

## Approach

### 1. [src/secrets.ts](../src/secrets.ts) — drop plaintext, add a `configured` flag
- `EncryptionMode` -> `'safeStorage' | 'passphrase'` (remove `'plaintext'`).
- `defaultEnvelope()`: `mode: getSafeStorage() ? 'safeStorage' : 'passphrase'`. A passphrase envelope with no `kdf`/`verifier` is the "unconfigured" state (nothing is ever written in this state because `saveManyKeys` is already a no-op while locked).
- `encryptValue` / `decryptValue`: remove the `plaintext` branches.
- `parseEnvelope`: drop `plaintext` from the valid-mode check; a stored `plaintext` mode now parses as invalid -> `defaultEnvelope()` (fresh start, consistent with the pre-release no-migration rule).
- `changeEncryptionMode`: remove plaintext handling (only `safeStorage` and `passphrase` remain; the non-passphrase branch keeps `unlockedKey = null`).
- `EncryptionStatus`: add `configured: boolean`, computed in `getEncryptionStatus` as `mode !== 'passphrase' || (envelope.kdf != null && envelope.verifier != null)`. Distinguishes "passphrase set but locked" (unlock) from "no passphrase yet" (create).

### 2. [src/main.ts](../src/main.ts) — make `promptUnlock` branch on `configured`
- When `!encryptionStatus.configured`: open `PassphraseModal` in *create* mode (`requireConfirm: true`, `onSubmit` -> `changeEncryptionMode(this, 'passphrase', pass)` then hydrate + refresh). Reuses the exact flow already in `handleModeChange('passphrase')`.
- When `configured` (and locked): existing unlock flow (`unlockSecrets`).
- The four entry points ([src/ui/modal.ts](../src/ui/modal.ts), [src/ui/quick-record.ts](../src/ui/quick-record.ts), [src/ui/text-source.ts](../src/ui/text-source.ts), [src/ui/audio-source.ts](../src/ui/audio-source.ts)) already gate on `encryptionStatus.locked` and call `promptUnlock()`; unconfigured-passphrase is `locked === true`, so they fire correctly with no change. Only `promptUnlock`'s body changes. Keep the method name (avoids churn across 5 call sites; the create branch is an internal detail of "ensure secrets are usable").

### 3. [src/settings/tab.ts](../src/settings/tab.ts) — UI cleanup + first-run prompt
- Dropdown: remove the `dd.addOption('plaintext', ...)` line.
- Banner (`renderEncryption`): remove the `else if (status.mode === 'plaintext')` branch. Add a branch for `mode === 'passphrase' && !status.configured` (reuse the `is-warning` class) reading "Set a passphrase to store your API keys securely." with a "Set passphrase" button -> `promptUnlock(() => this.display())` (now routes to create). Keep the existing `status.locked` branch for the configured-but-locked case; its copy ("Enter your passphrase to decrypt") is then only shown when a passphrase already exists.
- `encryptionModeDescription`: remove the "Plaintext: no encryption..." line.
- `handleModeChange`: the non-passphrase path now only ever switches to `safeStorage`; simplify the label to `'OS keychain'`.
- `EncryptionStatus` consumers in this file take the new `configured` field automatically (it widens the existing snapshot type).
- Minor: `apiKeyPlaceholder` wording when locked-and-unconfigured ("Set a passphrase to store keys") — optional polish.

### 4. Docs
- [CLAUDE.md](../CLAUDE.md) "Secrets encryption" section: reduce the mode list to two, update the envelope description, rewrite the first-run-fallback note (now passphrase-unconfigured, not plaintext), and note that existing dev installs in plaintext lose stored keys (re-enter; per the pre-release no-migration rule).
- [docs/claude-scratch/STATUS.md](claude-scratch/STATUS.md): add a future-work / decision entry: "Adopt Obsidian SecretStorage (`app.secretStorage`, 1.11.4+) as an encryption mode once GA and available on mobile. Deferred 2026-05-28 (early-access). Would become the zero-config option that plaintext used to provide."
- Sweep `plaintext` across the repo (docs + `styles.css`) and update any user-facing copy. `styles.css` `.is-warning` stays used (reassigned to the unconfigured-passphrase banner).

## Reuse (do not write new)
- `PassphraseModal` ([src/ui/passphrase-modal.ts](../src/ui/passphrase-modal.ts)) for the create-passphrase prompt.
- `changeEncryptionMode(plugin, 'passphrase', pass)` already creates the kdf+verifier and re-encrypts existing keys; reuse for both the create flow and desktop safeStorage->passphrase switching.

## Out of scope (explicit)
- Building anything against `app.secretStorage` / `SecretComponent` (deferred to GA).
- The shared-secret "store a reference by name" rearchitecture. The plugin keeps its value-owning model.
- Any migration code for existing plaintext installs.

## Verification
- `npm run build` (tsc `-noEmit` typecheck + esbuild) and `npm run lint` — CI parity. Confirm zero remaining `'plaintext'` references and no type errors from the narrowed `EncryptionMode`.
- Manual, desktop with keychain: Settings -> API key encryption shows only "OS keychain" and "Passphrase"; keys save/load; switch to passphrase (set + unlock + lock) and back to OS keychain.
- Manual, no-keychain path (test on mobile, or temporarily force `getSafeStorage()` to return `null`): first run shows the "Set a passphrase" banner; API key fields gated until set; after setting, keys persist; lock -> entry points (Open modal, Quick record, Process text, Reprocess audio) prompt to unlock; unconfigured state prompts to create. Reload to confirm the envelope round-trips.

## Future work (SecretStorage, when GA)
When `app.secretStorage` reaches GA and is confirmed on mobile, add a `secretStorage` encryption mode that routes `saveKey`/`loadKey`/`loadAllKeys` to `setSecret`/`getSecret`/`listSecrets` under the existing key IDs (`profile:desktop:transcription`, etc.). It would become the zero-config, cross-platform option that plaintext used to provide, sitting alongside `safeStorage` and `passphrase`. Bump the obsidian dev dependency for real typings and raise `minAppVersion` to the GA version at that time.

## Update 2026-06-14 — IMPLEMENTED (and it REPLACED safeStorage)

`secretStorage` mode shipped. It did NOT sit alongside `safeStorage`; it **replaced** it. Obsidian's `app.secretStorage` uses the same OS-keychain backend our hand-rolled `safeStorage` mode did, so keeping both was redundant. The OS-keychain mode was never released (plugin still unpublished), so `safeStorage` was removed outright with no migration. Final user-facing model: **`secretStorage`** (preferred/default when available) + **`passphrase`** (always-available fallback).

Deviations from the plan above:
- **`minAppVersion` stays `1.4.0`** (not raised). `secretStorage` is feature-detected at runtime via a narrow `SecretStorageLike` cast + a round-trip self-test, so older Obsidian still loads the plugin and lands on passphrase. No obsidian dep bump was needed.
- Keys are **namespaced with `manifest.id`** (the store is shared across plugins).
- Values live in Obsidian's store, not `secrets.json.nosync` (the envelope just records `mode`). This means keys **may sync across devices** via Obsidian Sync — disclosed in the settings mode description.
- See CLAUDE.md "Secrets encryption" for the current behavior.
