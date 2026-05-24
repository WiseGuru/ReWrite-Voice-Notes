# ReWrite (Voice Notes)

An Obsidian plugin that captures speech (live recording or pasted transcript), runs it through a transcription provider, cleans and structures it with an LLM, and inserts the result into your vault.

You bring your own provider keys. Nothing is sent to a ReWrite server; the plugin only talks to the endpoints you configure.

## Features

- Record audio directly in Obsidian, or paste a pre-existing transcript.
- 6 transcription providers: OpenAI Whisper, OpenAI-compatible (whisper.cpp, faster-whisper-server, etc.), Groq, AssemblyAI, Deepgram, Rev.ai, and the browser-native Web Speech API.
- 5 LLM providers for cleanup: Anthropic Claude, OpenAI GPT, OpenAI-compatible (Ollama, LM Studio), Google Gemini, Mistral.
- Desktop and Mobile profiles, auto-selected by environment with a manual override.
- 5 starter templates (General cleanup, Todo list, Daily note, Meeting notes, Idea capture); fully editable and reorderable.
- Quick Record command for one-shot capture with no modal: ribbon icon, command palette, or a custom hotkey.
- Three insert modes: at the cursor, append to the active note, or create a new note with `{{date}}` / `{{time}}` filename templating.

## Install

### Manual install (current method)

Until the plugin is in the community plugin directory, install manually:

1. Build or download the release artifacts: `main.js`, `manifest.json`, `styles.css`.
2. Create the folder `<YourVault>/.obsidian/plugins/rewrite-plugin/`.
3. Copy the three files into that folder.
4. In Obsidian, go to Settings, Community plugins, and enable "ReWrite (Voice Notes)". (Make sure Restricted mode is off.)
5. Open Settings, ReWrite (Voice Notes), enter at least one provider API key, and pick a model for both the transcription and LLM provider.

### Building from source

```bash
git clone https://github.com/<your-fork>/rewrite-plugin.git
cd rewrite-plugin
npm install
npm run build
```

`main.js`, `styles.css`, and `manifest.json` will be at the repo root. Copy them into your vault as described above.

## Excluding `secrets.json.nosync` from sync

API keys are stored in `<YourVault>/.obsidian/plugins/rewrite-plugin/secrets.json.nosync`, separately from the rest of the plugin's settings.

On desktop, the file contains keys encrypted with Electron's `safeStorage` API, which is tied to the user account on that specific machine. The encrypted blob cannot be decrypted on another desktop, on mobile, or in a fresh OS profile. On mobile, keys are stored in plaintext because `safeStorage` is not available.

For both of those reasons, **you should exclude `secrets.json.nosync` from any vault sync mechanism** and enter keys once per device. Configure the exclusion **before the first sync**, since files already uploaded usually remain on the remote.

The path to exclude is always:

```
.obsidian/plugins/rewrite-plugin/secrets.json.nosync
```

### Obsidian Sync (official)

Obsidian Sync excludes folders, not individual files (Settings, Sync, Excluded folders). You have two options:

- Exclude the entire `.obsidian/plugins/rewrite-plugin` folder and accept that you will lose template/profile sync (`data.json` lives there too).
- Or sync the folder and accept that the encrypted `secrets.json.nosync` blob will be uploaded; on other devices it will fail to decrypt and the plugin will treat it as no key set, prompting you to enter the key again.

### Syncthing

Add to `.stignore` in the synced folder root:

```
// ReWrite plugin secrets, never sync API keys
.obsidian/plugins/rewrite-plugin/secrets.json.nosync
```

If the vault is not at the Syncthing folder root, omit the leading slash from any patterns.

### Resilio Sync

Add this line to `.sync/IgnoreList` on each peer:

```
.obsidian/plugins/rewrite-plugin/secrets.json.nosync
```

### Git / GitHub

Add to the vault's `.gitignore`:

```gitignore
# ReWrite plugin, never commit API keys
.obsidian/plugins/rewrite-plugin/secrets.json.nosync
```

If you have already committed it:

```bash
git rm --cached .obsidian/plugins/rewrite-plugin/secrets.json.nosync
git commit -m "remove rewrite-plugin secrets from tracking"
```

### Dropbox

Dropbox has no ignore-file mechanism. Use Selective Sync:

1. Open the Dropbox desktop app.
2. Preferences, Sync, Selective Sync.
3. Deselect the `rewrite-plugin` plugin folder, or use file-level exclusions if your Dropbox plan supports them.

Alternatively, delete `secrets.json.nosync` from Dropbox via the web interface after setup; the plugin will recreate it locally when you next enter keys.

### iCloud Drive

No configuration needed. iCloud Drive automatically skips any file or folder whose name ends in `.nosync`, which is why the plugin uses that suffix.

### FolderSync (Android)

In each sync pair, go to Filters, Excluded files, and add the pattern:

```
secrets.json.nosync
```

## Mobile limitations

Obsidian on iOS and Android runs in a constrained WebView. A few things behave differently from desktop:

- **Web Speech (default mobile transcription provider)** is unavailable on iOS Obsidian (WKWebView does not implement `SpeechRecognition`). On Android, support is patchy. If Web Speech is unavailable, the modal surfaces a notice and you can switch to the Paste tab or pick a different transcription provider on your Mobile profile.
- **iOS screen-off**: `MediaRecorder` silently stops capturing audio when the screen turns off on iOS. The plugin cannot prevent this; keep the screen on while recording, or use the Paste tab with an OS-level dictation keyboard.
- **API keys are stored in plaintext on mobile** because Electron's `safeStorage` is not available. The `secrets.json.nosync` file still uses the `.nosync` filename so iCloud Drive will skip it, but for other sync tools you must apply the exclusion rules above.
- **Recording size limit**: clips over 25 MB are rejected. This is a transcription-API limit, not an Obsidian one, and is most likely to bite on long mobile recordings.

## Known limitations (v1)

- No audio playback or waveform display.
- Raw audio is not saved to the vault, only the cleaned transcript.
- LLM responses are not streamed; you see the cleaned output once the whole response arrives.
- No speaker diarization.
- No long-audio chunking; clips over 25 MB error out instead of being split.
- The OpenAI-compatible transcription endpoint expects a server that mirrors Whisper's `/v1/audio/transcriptions` shape (whisper.cpp, faster-whisper-server). The OpenAI-compatible LLM endpoint expects a `/chat/completions` shape (Ollama, LM Studio, etc.).
- Anthropic Claude calls go through Obsidian's `requestUrl`, which bypasses browser CORS. If you reuse the same endpoint from another tool that uses `fetch`, you will need their browser-direct-access header.

## Acknowledgements

- [Magic Mic](https://github.com/drewmcdonald/obsidian-magic-mic) by Drew McDonald (MIT, archived): originator of the MIME-type fallback and `MediaRecorder` patterns this plugin borrows.
- [Scribe](https://github.com/Mikodin/obsidian-scribe) by Mike Alicea: prior art for the record, transcribe, cleanup, and templated-insert flow inside Obsidian.
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin): the scaffold this repository was built on.

## License

MIT. See [LICENSE](LICENSE).
