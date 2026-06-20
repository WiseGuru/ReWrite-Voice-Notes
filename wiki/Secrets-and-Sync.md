# Secrets and sync

How ReWrite stores your API keys, and how to keep the key file off whatever sync mechanism you use.

## Where keys live

API keys are stored in `<YourVault>/.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync`, separately from the rest of the plugin's settings (`data.json`). Keys are never written to `data.json`.

## Encryption modes

The plugin encrypts keys at rest in one of two modes, selectable in Settings under **API key encryption**. There is no unencrypted option.

- **Obsidian secret storage** (`secretStorage`): the default when available (a recent Obsidian with a working OS secret store). Keys go into Obsidian's built-in secret store, encrypted at rest by your OS keychain and shared across plugins. Because it is Obsidian-managed, **if you use Obsidian Sync these keys may sync across your devices**, a convenience that also means your keys leave the single-device boundary. The plugin runs a round-trip self-test and falls back to passphrase on a device without a working OS secret store (for example Linux without a keyring). In this mode the keys do **not** live in `secrets.json.nosync` (that file only records which mode is in use).
- **Passphrase**: AES-GCM with a key derived from a passphrase you set, using Argon2id (memory-hard) or PBKDF2 where Argon2id cannot run. Works on every platform including mobile; the keys stay on the device (encrypted in `secrets.json.nosync`) and the blob is portable (re-enter the passphrase to unlock on each device). The plugin enforces a minimum passphrase strength and offers a one-click 6-word generator. On devices where secret storage is unavailable, setting a passphrase is required before any key can be saved.

Passphrase mode locks and unlocks: **Lock now** clears the derived key from memory, and the next pipeline run prompts you to unlock. The derived key never touches disk.

### Switching, copying, and clearing keys

Switching the **Encryption mode** dropdown changes which method is *active* but **does not move your keys**. The two methods can hold keys at the same time, so a switch is safe and reversible: keys saved under the other method stay where they are (the passphrase file keeps its encrypted snapshot; secret-storage keys stay in your OS keychain). The newly active method may simply show no keys until you copy or re-enter them.

Two explicit buttons handle the key material, each behind a confirmation:

- **Copy keys from &lt;other method&gt;** duplicates the keys saved under the *inactive* method into the *active* one. The originals are kept (use Clear to remove them). When the source is the passphrase store, you are prompted for that passphrase first. A notice reports how many keys were copied.
- **Clear keys in &lt;method&gt;** permanently deletes the keys saved under the selected method. Clearing the active passphrase store leaves it unconfigured, so you would set a passphrase again (or switch methods) before saving more keys.

A typical move from passphrase to secret storage: switch the dropdown to **Obsidian secret storage**, click **Copy** (enter your passphrase when asked), confirm, then optionally **Clear** the passphrase store once you have verified everything works.

The deeper implementation detail (envelope schema, KDF parameters, the switch/copy/clear model) is developer-facing and lives in the repo's `docs/SECRETS.md`.

## Excluding `secrets.json.nosync` from sync

If you use **passphrase mode** and do not want the encrypted key file copied between devices, exclude it from your sync and enter keys once per device. Configure the exclusion **before the first sync**, since files already uploaded usually remain on the remote. (In secret-storage mode this file holds no keys, so excluding it has no effect on the keys themselves.)

The path to exclude is always:

```
.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
```

### Obsidian Sync (official)

Obsidian Sync excludes folders, not individual files (Settings, Sync, Excluded folders). Two options:

- Exclude the whole `.obsidian/plugins/rewrite-voice-notes` folder and accept losing template/profile sync (`data.json` lives there too).
- Or sync the folder and accept that the encrypted `secrets.json.nosync` blob uploads; on other devices it fails to decrypt and the plugin treats it as no key set, prompting you to re-enter.

### Syncthing

Add to `.stignore` in the synced folder root:

```
// ReWrite plugin secrets, never sync API keys
.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
```

If the vault is not at the Syncthing folder root, omit the leading slash from any patterns.

### Resilio Sync

Add this line to `.sync/IgnoreList` on each peer:

```
.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
```

### Git / GitHub

Add to the vault's `.gitignore`:

```gitignore
# ReWrite plugin, never commit API keys
.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
```

If you already committed it:

```bash
git rm --cached .obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
git commit -m "remove rewrite-voice-notes secrets from tracking"
```

### Dropbox

Dropbox has no ignore-file mechanism. Use Selective Sync:

1. Open the Dropbox desktop app.
2. Preferences, Sync, Selective Sync.
3. Deselect the `rewrite-voice-notes` plugin folder, or use file-level exclusions if your plan supports them.

Alternatively, delete `secrets.json.nosync` from Dropbox via the web interface after setup; the plugin recreates it locally when you next enter keys.

### iCloud Drive

No configuration needed. iCloud Drive automatically skips any file whose name ends in `.nosync`, which is why the plugin uses that suffix.

### FolderSync (Android)

In each sync pair, go to Filters, Excluded files, and add the pattern:

```
secrets.json.nosync
```

[Back to Home](Home)
