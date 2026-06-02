# ReWrite (Voice Notes)

An Obsidian plugin that captures speech (live recording or pasted transcript), runs it through a transcription provider, cleans and structures it with an LLM, and inserts the result into your vault.

You bring your own provider keys. Nothing is sent to a ReWrite server; the plugin only talks to the endpoints you configure.

## Features

- Record audio directly in Obsidian, or paste a pre-existing transcript.
- 8 transcription providers: OpenAI Whisper, OpenAI-compatible (whisper.cpp, faster-whisper-server, etc.), Groq, AssemblyAI, Deepgram, Rev.ai, Mistral Voxtral, and a plugin-managed local whisper.cpp server (desktop).
- 5 LLM providers for cleanup: Anthropic Claude, OpenAI GPT, OpenAI-compatible (Ollama, LM Studio), Google Gemini, Mistral.
- Desktop and Mobile profiles, auto-selected by environment with a manual override.
- 7 starter templates (General cleanup, Todo list, Daily note, Meeting notes, Idea capture, Lecture, Podcast), stored as editable Markdown files in your vault and ordered by filename (prefix with `01-`, `02-`, etc. to reorder).
- **Shared core**: a single vault Markdown file (`ReWrite/SharedCore.md`) holds the cleanup ground rules (don't act on the transcript, fix grammar/fillers, output only the result) that prefix every template, so you edit the baseline once. Trim it to save tokens, set `disableSharedCore: true` in a template's frontmatter to skip it there, or delete the file to turn it off entirely.
- Quick Record command for one-shot capture with no modal: ribbon icon, command palette, or a custom hotkey.
- Three insert modes: at the cursor, append to the active note, or create a new note with `{{date}}` / `{{time}}` filename templating. The modal's per-run Destination control overrides the template's mode, folder, and filename for a single run without editing the template.
- **Process text with a template**: run any template over the current selection or whole note body, no audio needed, from the command palette or the editor right-click menu.
- **Reprocess audio**: rerun the pipeline over an audio file already in your vault, from the command palette, the file-explorer right-click menu, or by placing the cursor inside an `![[audio]]` embed. Useful for retrying with a different template or provider, and for long-form content like lectures and podcasts (see [Long-form audio](#long-form-audio-lectures-podcasts)).
- **Speaker identification (diarization)**: opt-in `Speaker A:` / `Speaker B:` labels for multi-speaker recordings, preserved through cleanup. Available with AssemblyAI, Deepgram, and Rev.ai.
- **Saved recordings**: each recording is written to your attachments folder and linked back into the output with an `![[...]]` embed, so the original audio stays in your vault.
- **Ad-hoc voice instructions**: speak your assistant's name followed by an instruction mid-recording (e.g. "Scrivener, turn this into a checklist") and the directive is extracted and added to the cleanup prompt for that run only. The trigger word is configurable.
- **Assistant prompt**: a vault Markdown file defines the persona and standing instructions prefaced to the cleanup step, so you can shape tone and behavior without touching settings.
- **Known nouns**: a vault Markdown file of proper nouns (with optional misheard variants) that the LLM preserves verbatim, fixing names the transcriber tends to mangle.
- **API key encryption**: keys are stored per device in the verified OS keychain (desktop) or with a strength-checked passphrase using Argon2id/PBKDF2 AES-GCM (cross-platform). There is no unencrypted option.

## Tested providers

ReWrite ships adapters for every provider listed below, but only some have been exercised end to end so far. "Tested" means a maintainer has run the full record/transcribe/cleanup/insert flow against that service. "Untested" means the adapter is implemented to the provider's documented API shape but has not yet been verified against a live account. Untested does not mean broken; it means unverified, so treat reports of issues there as expected and welcome.

### Transcription

| Provider | Status |
| --- | --- |
| Local whisper.cpp (plugin-managed) | ✅ Tested |
| Mistral Voxtral | ✅ Tested |
| AssemblyAI | ✅ Tested |
| OpenAI Whisper | Untested |
| OpenAI-compatible (whisper.cpp, faster-whisper-server) | Untested |
| Groq | Untested |
| Deepgram | Untested |
| Rev.ai | Untested |

### LLM (cleanup)

| Provider | Status |
| --- | --- |
| Anthropic Claude | ✅ Tested |
| Mistral | ✅ Tested |
| OpenAI-compatible (Ollama, LM Studio) | ✅ Tested (local Ollama) |
| OpenAI GPT | Untested |
| Google Gemini | Untested |

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

## Local whisper.cpp server (desktop, optional)

If you want fully on-device transcription with no network calls, the plugin can spawn a [whisper.cpp](https://github.com/ggerganov/whisper.cpp) `whisper-server` binary that you supply. The plugin only reads the absolute paths you configure; it never downloads binaries, never looks them up on PATH, and never spawns anything you did not explicitly point it at. Desktop only.

### Disclosure

When you click Start in settings, the plugin launches whisper-server as a child process and communicates with it over loopback (`http://127.0.0.1:<port>`). The process is captured in a ring-buffered log you can view in settings. When you click Stop, or when the plugin is unloaded, the process is terminated. No code is downloaded or executed beyond the binary you provide.

**Network exposure**: whisper-server has no authentication and no TLS, so anyone who can reach its port can submit audio and exercise its native audio-decoding code. To keep it private, ReWrite always passes `--host 127.0.0.1` (loopback only) and **refuses to start** if you put a `--host` pointing at a non-loopback interface (such as `0.0.0.0` or a LAN IP) in Extra args. If you run whisper-server yourself from a terminal instead of letting the plugin manage it, bind it to `127.0.0.1` the same way; do not expose it to your network unless you have put your own authenticating proxy in front of it.

### Setup

1. Obtain a `whisper-server` binary:
   - **Windows**: download the latest `whisper-bin-x64.zip` (CPU) or `whisper-cublas-12.4.0-bin-x64.zip` (NVIDIA GPU) from the [whisper.cpp releases page](https://github.com/ggerganov/whisper.cpp/releases), unzip somewhere stable (e.g. `C:\Tools\whisper.cpp\`), and use the path to `whisper-server.exe` inside that folder.
   - **macOS**: the easiest path is Homebrew (`brew install whisper-cpp`), which installs a `whisper-server` binary; `which whisper-server` will show its absolute path. Or build from source the same way as Linux below.
   - **Linux**: there are no official Linux binaries on the releases page, so you build from source once. See "Building whisper-server on Linux" just below.
2. Download a GGML model file. Two sources work out of the box:
   - **Upstream GGML models** from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp/tree/main), e.g. `ggml-base.en.bin`, `ggml-small.bin`, `ggml-large-v3.bin`. Larger models are more accurate and slower.
   - **FUTO whisper-acft models** (see the next section). These are quantized, finetuned variants that support dynamic audio context; they load with the same `-m` flag as upstream models.
3. Open ReWrite settings, scroll to "Local whisper.cpp server (desktop)", and fill in:
   - Binary path: absolute path to `whisper-server` (or `whisper-server.exe` on Windows).
   - Model path: absolute path to the `.bin` file.
   - Port: defaults to 8080.
4. Click Start. The status indicator transitions from Stopped to Starting to Running. View log shows whisper-server's stdout/stderr if startup fails.
5. In the profile you want to use it from, set Transcription provider to "Local whisper.cpp (desktop only)". The Transcription model field is decorative for this provider; whisper-server uses whichever model file is loaded at startup.

### Building `whisper-server` on Linux

whisper.cpp doesn't publish prebuilt Linux binaries, so you need to compile it once. The build is quick (under a minute on a modern laptop) and produces a single executable that you then point the plugin at.

1. Install the toolchain. Pick the line for your distro:
   - Debian / Ubuntu / Mint: `sudo apt update && sudo apt install -y build-essential cmake git`
   - Fedora / RHEL: `sudo dnf install -y gcc-c++ make cmake git`
   - Arch / Manjaro: `sudo pacman -S --needed base-devel cmake git`
   - openSUSE: `sudo zypper install -y gcc-c++ make cmake git`

2. Clone and build:

   ```bash
   git clone https://github.com/ggerganov/whisper.cpp.git
   cd whisper.cpp
   cmake -B build -DCMAKE_BUILD_TYPE=Release
   cmake --build build -j --config Release
   ```

   The default build includes the `server` example, so no extra flags are needed. If you have an NVIDIA GPU and want CUDA acceleration, replace the first `cmake` line with `cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=ON` (requires the CUDA toolkit installed; the build takes substantially longer).

3. After the build finishes, the binary lives at:

   ```
   <path-to-clone>/build/bin/whisper-server
   ```

   Copy or symlink it somewhere stable (e.g. `~/.local/bin/whisper-server`) if you want to keep the absolute path short. Make sure it is executable: `chmod +x build/bin/whisper-server`.

4. Use that absolute path as Binary path in the plugin's "Local whisper.cpp server (desktop)" settings section. To sanity-check the binary outside the plugin first, run it once from a terminal with a model file: `./build/bin/whisper-server -m /path/to/model.bin --host 127.0.0.1 --port 8080`. You should see `whisper server listening at http://127.0.0.1:8080`. Pass `--host 127.0.0.1` so the unauthenticated server stays bound to loopback and is not reachable from your network. Hit Ctrl-C to stop, then let the plugin manage it from there.

If `cmake --build` fails with `error: 'std::filesystem' has not been declared` or similar C++17 errors, your distro's default GCC is too old. Install a newer one (`sudo apt install g++-12` on Ubuntu) and rerun the `cmake -B build ...` step with `-DCMAKE_CXX_COMPILER=g++-12` appended.

### FUTO whisper-acft models

[whisper-acft](https://github.com/futo-org/whisper-acft) is a set of Whisper checkpoints finetuned by FUTO so that whisper.cpp's encoder tolerates a dynamic `audio_ctx` (the number of audio frames the encoder processes). With stock Whisper models, lowering `audio_ctx` to match shorter clips makes the decoder unstable; the ACFT models were retrained to handle this gracefully, which can cut latency on short utterances substantially (often a 2x to 4x speedup on the small models, depending on hardware).

The published checkpoints are quantized to `q8_0` and ship in the same GGML container that whisper.cpp's `-m` flag already accepts, so no special build of whisper-server is required. You just need a whisper.cpp version recent enough to recognize the `-ac` / `--audio-context` flag (any reasonably current `whisper-server` release does).

1. Pick a model and download the `.bin` directly. English-only checkpoints are smaller and faster for English input; multilingual handles other languages but is slightly slower at the same size.

   English-only:
   - tiny.en: `https://voiceinput.futo.org/VoiceInput/tiny_en_acft_q8_0.bin`
   - base.en: `https://voiceinput.futo.org/VoiceInput/base_en_acft_q8_0.bin`
   - small.en: `https://voiceinput.futo.org/VoiceInput/small_en_acft_q8_0.bin`

   Multilingual:
   - tiny: `https://voiceinput.futo.org/VoiceInput/tiny_acft_q8_0.bin`
   - base: `https://voiceinput.futo.org/VoiceInput/base_acft_q8_0.bin`
   - small: `https://voiceinput.futo.org/VoiceInput/small_acft_q8_0.bin`

   Save the file anywhere you like (the same folder as your other GGML models is fine). Verify the download finished cleanly before pointing the plugin at it; a truncated `.bin` will fail to load with a cryptic error in the log tail.

2. In ReWrite settings under "Local whisper.cpp server (desktop)", set Model path to the absolute path of the FUTO `.bin` you just downloaded. Binary path and Port are unchanged from the standard setup above.

3. Set Extra args (in the "Local whisper.cpp server (desktop)" section) to:

   ```
   -ac 768
   ```

   Do not add a `--host` here pointing at a non-loopback interface; ReWrite binds the server to `127.0.0.1` and will refuse to start otherwise (the server is unauthenticated).

   `-ac` (alias `--audio-context`) caps the encoder context at the given number of mel frames. Lower values run faster but only stay accurate on ACFT-finetuned models, which is the whole point of using them. A few starting points:

   - `-ac 768` is a sensible default for short to medium clips (roughly up to ~15 s). Drop to `-ac 512` for short voice memos under ~10 s.
   - `-ac 1500` (the whisper.cpp default for 30 s of audio) disables the speedup. Use this if you regularly dictate longer than ~20 s and notice the tail being cut off.
   - You can pass additional flags on the same line, space-separated, e.g. `-ac 768 -t 4` to also cap CPU threads at 4.

4. Click Start (or Restart if the host was already running). The status pill should return to Running and the View log output should show whisper-server loading the ACFT model file. From the consuming profile, the Local whisper.cpp transcription provider needs no changes; it forwards the audio over the same `/v1/audio/transcriptions` endpoint and the `-ac` value is applied server-side.

If transcription quality drops noticeably (truncated sentences, missing trailing words), raise `-ac` toward 1500 until it stabilizes. The right value depends on how long your typical recording is; there is no single best number.

### Troubleshooting

- **Port already in use**: another process is bound to the configured port. Change the port (or stop the other process). The plugin will not kill processes it did not start.
- **Antivirus quarantine on Windows**: Windows Defender or third-party AV may flag `whisper-server.exe` on first run. The plugin cannot work around this; whitelist the binary in your AV settings.
- **Permission denied on macOS or Linux**: ensure the binary is executable (`chmod +x whisper-server`).
- **Process did not become ready within 5 s**: the model failed to load (file path wrong, file corrupted, RAM exhausted). The log tail will show whisper.cpp's error.
- **`unknown argument: -ac` (or `--audio-context`) in the log**: your `whisper-server` build predates the dynamic audio-context flag. Update to a current whisper.cpp release, or remove the `-ac` value from Extra args (you can still use the FUTO model files without the flag, you just lose the latency benefit).
- **FUTO model loads but transcripts are truncated or jumbled**: `-ac` is set too low for the length of audio you are dictating. Raise it (e.g. `768` to `1024` to `1500`) until the output is stable.

## Long-form audio (lectures, podcasts)

ReWrite is not just for quick voice memos. The same pipeline cleans up and structures long recordings such as lectures, meetings, interviews, and podcasts. Nothing special is required: you process a long file the same way you reprocess any audio already in your vault.

### Workflow

1. **Get the audio file.** A mic recording you made, an export from a meeting tool (Zoom, Teams, Meet), a ripped CD, or any audio file you already have. For YouTube specifically, a third-party downloader such as [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) can extract the audio track. **Make sure you have the right to the audio first**: downloading YouTube content without permission violates YouTube's Terms of Service and may infringe copyright. Only process audio you are allowed to.
2. **Drop the file into your vault** anywhere (for example an `Attachments` or `Recordings` folder).
3. **Reprocess it.** Right-click the file in the file explorer and choose **"Reprocess audio with template..."**. The same action is available from the command palette (**"Reprocess audio file with template"**) and from the editor menu when your cursor sits inside an `![[audio]]` embed.
4. **Pick a template.** **Lecture** restructures a single-speaker talk into Summary / Key concepts / Definitions / Examples / Open questions / References. **Podcast** produces Summary / Speakers / Topics discussed / Notable quotes / References / Takeaways.
5. **Choose a destination** if the template's default folder is wrong (the modal's Destination control isn't on the reprocess path, so set the folder/filename on the template itself, or move the note afterward).

### Duration and size caps

Very long recordings can exceed a provider's limits. The per-provider byte and duration ceilings live in [src/transcription/limits.ts](src/transcription/limits.ts). For multi-hour content, prefer **AssemblyAI** (up to 10 h) or **Rev.ai** (up to 17 h); OpenAI Whisper and Groq cap at 25 MB, and Mistral Voxtral at 30 minutes.

### Speaker labels (diarization)

For podcasts, meetings, and interviews, you can turn on **Identify speakers** in the transcription section of your profile settings. When enabled, the transcript comes back with `Speaker A:` / `Speaker B:` (or `Speaker 1:` / `Speaker 2:`) prefixes, and the cleanup step preserves them. This works **only** with **AssemblyAI**, **Deepgram**, and **Rev.ai**; the toggle is hidden for providers that cannot diarize (OpenAI Whisper, Groq, Mistral Voxtral, local whisper.cpp). Diarization quality varies: the speaker count is a guess and labels can drift mid-conversation. The Podcast template handles both labeled and unlabeled transcripts, so it works either way.

## Excluding `secrets.json.nosync` from sync

API keys are stored in `<YourVault>/.obsidian/plugins/rewrite-plugin/secrets.json.nosync`, separately from the rest of the plugin's settings.

The plugin supports two at-rest encryption modes for this file, selectable in settings under "API key encryption". There is no unencrypted option:

- **OS keychain** (`safeStorage`): the default on desktop when available. Keys are encrypted with Electron's `safeStorage` API, which is tied to the user account on that specific machine. The plugin verifies the keychain with a round-trip self-test and refuses to use a backend that does not actually encrypt (such as Linux's `basic_text` fallback), steering you to a passphrase instead. The encrypted blob cannot be decrypted on another desktop, on mobile, or in a fresh OS profile.
- **Passphrase**: AES-GCM encryption with a key derived from a passphrase you set, using Argon2id (a memory-hard key-derivation function) or PBKDF2 on devices that cannot run Argon2id. Works on every platform including mobile, and the blob is portable across devices (you re-enter the passphrase to unlock on each one). When you set a passphrase the plugin enforces a minimum strength and offers a one-click generator that produces a strong 6-word passphrase. On devices without an OS keychain (mobile, Linux-without-keyring), setting a passphrase is required before any key can be saved.

Unless you are using passphrase mode, **you should exclude `secrets.json.nosync` from any vault sync mechanism** and enter keys once per device. Configure the exclusion **before the first sync**, since files already uploaded usually remain on the remote.

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

- **iOS screen-off**: `MediaRecorder` silently stops capturing audio when the screen turns off on iOS. The plugin cannot prevent this; keep the screen on while recording, or use the Paste tab with an OS-level dictation keyboard.
- **Mobile requires a passphrase** because Electron's `safeStorage` (the OS keychain) is not available there. On first use the plugin prompts you to set a passphrase before any key can be saved; keys are then encrypted with Argon2id/PBKDF2 AES-GCM. The `secrets.json.nosync` file uses the `.nosync` filename so iCloud Drive will skip it; for other sync tools, apply the exclusion rules above (or use passphrase mode if you intend to sync the file, since the blob is portable when you re-enter the passphrase).
- **Recording size limit**: each transcription provider enforces its own ceiling (OpenAI Whisper and Groq are the tightest at 25 MB; AssemblyAI, Deepgram, and Rev.ai allow gigabytes). These are provider-API limits, not Obsidian ones, and are most likely to bite on long mobile recordings with the 25 MB providers.

## Known limitations (v1)

- No audio playback or waveform display.
- LLM responses are not streamed; you see the cleaned output once the whole response arrives.
- No speaker diarization.
- No long-audio chunking; clips that exceed the active provider's size or duration limit error out instead of being split.
- The OpenAI-compatible transcription endpoint expects a server that mirrors Whisper's `/v1/audio/transcriptions` shape (whisper.cpp, faster-whisper-server). The OpenAI-compatible LLM endpoint expects a `/chat/completions` shape (Ollama, LM Studio, etc.).
- Anthropic Claude calls go through Obsidian's `requestUrl`, which bypasses browser CORS. If you reuse the same endpoint from another tool that uses `fetch`, you will need their browser-direct-access header.

## Acknowledgements

- [Magic Mic](https://github.com/drewmcdonald/obsidian-magic-mic) by Drew McDonald (MIT, archived): originator of the MIME-type fallback and `MediaRecorder` patterns this plugin borrows.
- [Scribe](https://github.com/Mikodin/obsidian-scribe) by Mike Alicea: prior art for the record, transcribe, cleanup, and templated-insert flow inside Obsidian.
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin): the scaffold this repository was built on.

## License

MIT. See [LICENSE](LICENSE).
