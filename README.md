# ReWrite (Voice Notes)

An Obsidian plugin that captures speech (live recording or pasted transcript), runs it through a transcription provider, cleans and structures it with an LLM, and inserts the result into your vault.

You bring your own provider keys. Nothing is sent to a ReWrite server; the plugin only talks to the endpoints you configure. It can also run entirely on-device: pair the plugin-managed whisper.cpp transcription with a local OpenAI-compatible LLM (Ollama or llama.cpp) and no audio or text ever leaves your machine.

## Highlights

- Record in Obsidian, or paste and reprocess existing audio, then clean and structure it with an LLM and insert it into your vault.
- Bring-your-own keys across 8 transcription and 5 LLM providers, cloud or fully local; nothing goes to a ReWrite server.
- 10 editable Markdown templates (general cleanup, todo, daily note, meeting, lecture, podcast, guides, book log, and more) plus a shared-core baseline you edit once.
- Speaker diarization, saved-audio embeds, spoken ad-hoc instructions, known-nouns preservation, and per-run destination overrides.
- API keys encrypted at rest (OS secret storage, or an Argon2id/PBKDF2 passphrase) on desktop and mobile.

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
| DeepSeek / Kimi / Qwen / GLM (cloud OpenAI-compatible) | Untested |

## Cloud OpenAI-compatible LLMs (DeepSeek, Kimi, Qwen, GLM)

Many cloud LLM services speak the same `/chat/completions` dialect as OpenAI, so they work through the
**OpenAI-compatible** LLM provider with no extra setup. In a profile, set LLM provider to "OpenAI-compatible
(cloud or local)", paste the base URL from the table below, type a model name, and enter your API key.

| Provider | LLM base URL | Example models |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| Kimi (Moonshot) | `https://api.moonshot.ai/v1` | `kimi-k2-0905-preview`, `moonshot-v1-32k` |
| Qwen (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-max`, `qwen-plus` |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` |

Notes:

- The base URL must include the version path (`/v1`, `/compatible-mode/v1`, etc.); the adapter appends
  `/chat/completions` to whatever you enter.
- The OpenAI-compatible provider has no model dropdown or Refresh button, so type the model ID by hand
  (the dropdowns above are just examples; consult the provider's docs for the current list).
- The URLs above are the international endpoints. China-region accounts can substitute the mainland
  endpoints instead, e.g. `https://api.moonshot.cn/v1` (Kimi) and
  `https://dashscope.aliyuncs.com/compatible-mode/v1` (Qwen).

## Using ReWrite

Once you have configured at least one transcription and one LLM provider (or just an LLM, for text-only flows), the day-to-day flow is:

- **Open the modal** with the ribbon mic icon, the "Open" command, or a hotkey you bind to it. Pick a template, then **Record** your voice, **Paste** an existing transcript, or pull text **From note**. The output is cleaned to the template's format and inserted at the cursor, appended to the current note, or written to a new note. When you record, the original audio is saved to your attachments folder and linked back into the result with an `![[...]]` embed.
- **Quick Record** captures with no modal: ribbon, command palette, or hotkey. "Quick record (last used)" uses your last template; "Quick record (set template)" uses the one you pin in settings. Press again to stop.
- **Process text with template** runs any template over the current selection (or the whole note if nothing is selected), no audio needed, from the command palette or the editor right-click menu.
- **Reprocess audio** reruns the pipeline over an audio file already in your vault, from the command palette, the file-explorer right-click menu, or by placing the cursor inside an `![[audio]]` embed. Handy for retrying with a different template or provider.

Long-form audio (lectures, meetings, interviews, podcasts) uses the very same pipeline: drop the file anywhere in your vault and **Reprocess** it with the **Lecture** or **Podcast** template. For multi-hour recordings choose a provider with a high ceiling such as **AssemblyAI** or **Rev.ai** (OpenAI Whisper and Groq cap at 25 MB, Mistral Voxtral at 30 minutes), and turn on **Identify speakers** in the profile's transcription settings to get `Speaker A:` / `Speaker B:` labels preserved through cleanup. Only process audio you have the right to use; downloading third-party content (e.g. from YouTube) without permission may violate its terms or copyright.

## Install

### Obsidian community plugins (recommended)

1. In Obsidian, open Settings, Community plugins, and turn off Restricted mode if it is on.
2. Click Browse, search for "ReWrite (Voice Notes)", and click Install, then Enable.
3. Open Settings, ReWrite (Voice Notes), enter at least one provider API key, and pick a model for both the transcription and LLM provider.

### Manual install (latest release)

If the plugin is not yet listed, or you want a specific build:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest entry on the GitHub Releases page.
2. Create the folder `<YourVault>/.obsidian/plugins/rewrite-voice-notes/`.
3. Copy the three files into that folder.
4. In Obsidian, go to Settings, Community plugins, and enable "ReWrite (Voice Notes)". (Make sure Restricted mode is off.)
5. Open Settings, ReWrite (Voice Notes), enter at least one provider API key, and pick a model for both the transcription and LLM provider.

### Building from source

```bash
git clone https://github.com/<your-fork>/rewrite-voice-notes.git
cd rewrite-voice-notes
npm install
npm run build
```

`main.js`, `styles.css`, and `manifest.json` will be at the repo root. Copy them into your vault as described above.

## Plugin map

### Commands

All commands are available from the command palette; most also have a UI entry point.

| Command | What it does |
| --- | --- |
| Open | Opens the main modal with your last-used template selected. Also the ribbon mic icon. |
| Quick record (last used) | Starts recording immediately with a floating mini-UI, using the last-used template. Press again to stop. |
| Quick record (set template) | Same one-shot capture, but always uses the template you pin in settings. |
| Process text with template | Runs a template over the editor selection (or whole note). Also on the editor right-click menu ("ReWrite with template..."). |
| Reprocess audio file with template | Reruns the pipeline over an audio file already in the vault. Also on the file-explorer and editor menus. |
| Start whisper host / Stop whisper host | Starts or stops the local whisper.cpp server (desktop, when the active profile uses it). |

A status-bar item shows the local whisper.cpp server's live state on desktop when that provider is active.

### Vault files

The plugin keeps its editable configuration as Markdown files in your vault (defaults shown; all paths are configurable). Click **Populate** in settings to create them on first run.

| Path | Purpose |
| --- | --- |
| `ReWrite/Templates/` | One Markdown file per template (YAML frontmatter + a prompt body). Sorted by filename, so prefix with `01-`, `02-`, etc. to reorder. |
| `ReWrite/SharedCore.md` | The cleanup ground rules prepended to every template prompt. Edit once to change the baseline; delete to turn it off. |
| `ReWrite/AssistantPrompt.md` | The persona and standing instructions prefaced to the cleanup step. |
| `ReWrite/KnownNouns.md` | Proper nouns the LLM should preserve verbatim, with optional misheard variants. |
| `ReWrite/Template guide.md` | A human-facing explanation of the template format. Never sent to an LLM. |
| `ReWrite/Template update report.md` | Written by the Update button when a shipped default has changed and needs your review. |
| Attachments folder | Saved recordings (Obsidian's attachment location, or a folder you configure). Each is linked into the output via `![[...]]`. |

### Templates

The 10 bundled templates are starting points; they are just files, so edit, rename, reorder, or add your own. `newFile` templates can have the LLM fill in frontmatter properties and generate the filename from the content.

| Template | Behavior |
| --- | --- |
| General cleanup | Light prose polishing (grammar, fillers); inserts at the cursor. |
| Todo list | Turns spoken items into a checklist. |
| Daily note | New file named by date; fills Calendar / Goals / Tasks, then a Braindump of the full cleaned transcript. |
| Meeting notes | New file; offers a context hint; sets subject / participants / date properties and a content-derived title. |
| Meeting transcript | Like Meeting notes, but forces diarization on for speaker-labeled input. |
| Idea capture | Quick capture of a single idea. |
| Lecture | New file; restructures a talk into Summary / Key concepts / Definitions / etc.; subject / lecturer / course properties + title. |
| Podcast | New file; tolerates diarized or flat input; podcast / episode / host / guests properties + title. |
| Guides | New file; turns a walkthrough into strict two-level how-to steps; topic / tool properties + title. |
| Book log | New file; short book-log body; title / author / series properties + content title. |

Diarization, when enabled on a capable provider, adds `Speaker X:` prefixes that the cleanup step preserves.

## Self Hosting

ReWrite can run with no cloud dependency by combining a local LLM for cleanup with the plugin-managed local whisper.cpp server for transcription.

### Local LLM (Ollama / llama.cpp)

Local LLM servers that speak the OpenAI `/chat/completions` dialect work through the **OpenAI-compatible** LLM provider. In a profile, set LLM provider to "OpenAI-compatible (cloud or local)", then fill in the base URL and model.

- **Ollama**: run `ollama serve` and `ollama pull <model>` (e.g. `llama3.1`). Base URL `http://localhost:11434/v1`, model = the pulled name. Ollama ignores the API key, so any non-empty placeholder is fine.
- **llama.cpp**: run `llama-server -m <model.gguf>`. Base URL `http://localhost:8080/v1`, model = whatever name the server reports.

The base URL must include the version path (`/v1`); the adapter appends `/chat/completions` to whatever you enter. Pair this with the local whisper.cpp server below for a setup where nothing leaves your machine.

### Local whisper.cpp server (desktop, optional)

If you want fully on-device transcription with no network calls, the plugin can spawn a [whisper.cpp](https://github.com/ggerganov/whisper.cpp) `whisper-server` binary that you supply. The plugin only reads the absolute paths you configure; it never downloads binaries, never looks them up on PATH, and never spawns anything you did not explicitly point it at. Desktop only.

#### Disclosure

When you click Start in settings, the plugin launches whisper-server as a child process and communicates with it over loopback (`http://127.0.0.1:<port>`). The process is captured in a ring-buffered log you can view in settings. When you click Stop, or when the plugin is unloaded, the process is terminated. No code is downloaded or executed beyond the binary you provide.

**Network exposure**: whisper-server has no authentication and no TLS, so anyone who can reach its port can submit audio and exercise its native audio-decoding code. To keep it private, ReWrite always passes `--host 127.0.0.1` (loopback only) and **refuses to start** if you put a `--host` pointing at a non-loopback interface (such as `0.0.0.0` or a LAN IP) in Extra args. If you run whisper-server yourself from a terminal instead of letting the plugin manage it, bind it to `127.0.0.1` the same way; do not expose it to your network unless you have put your own authenticating proxy in front of it.

#### Setup

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

#### Building `whisper-server` on Linux

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

#### FUTO whisper-acft models

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

#### Troubleshooting

- **Port already in use**: another process is bound to the configured port. Change the port (or stop the other process). The plugin will not kill processes it did not start.
- **Antivirus quarantine on Windows**: Windows Defender or third-party AV may flag `whisper-server.exe` on first run. The plugin cannot work around this; whitelist the binary in your AV settings.
- **Permission denied on macOS or Linux**: ensure the binary is executable (`chmod +x whisper-server`).
- **Process did not become ready within 5 s**: the model failed to load (file path wrong, file corrupted, RAM exhausted). The log tail will show whisper.cpp's error.
- **`unknown argument: -ac` (or `--audio-context`) in the log**: your `whisper-server` build predates the dynamic audio-context flag. Update to a current whisper.cpp release, or remove the `-ac` value from Extra args (you can still use the FUTO model files without the flag, you just lose the latency benefit).
- **FUTO model loads but transcripts are truncated or jumbled**: `-ac` is set too low for the length of audio you are dictating. Raise it (e.g. `768` to `1024` to `1500`) until the output is stable.

## Excluding `secrets.json.nosync` from sync

API keys are stored in `<YourVault>/.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync`, separately from the rest of the plugin's settings.

The plugin supports two at-rest encryption modes, selectable in settings under "API key encryption". There is no unencrypted option:

- **Obsidian secret storage** (`secretStorage`): the default when available (Obsidian 1.11.4 or later with a working OS secret store). Keys are stored in Obsidian's built-in secret store, which encrypts them at rest using your operating system's keychain and is shared across plugins. Because it is an Obsidian-managed store, **if you use Obsidian Sync these keys may sync across your devices** (a convenience, but note your keys then leave the single-device boundary). The plugin runs a round-trip self-test and falls back to passphrase on a device with no working OS secret store (for example Linux without a keyring). In this mode the keys do **not** live in `secrets.json.nosync` (that file only records which mode is in use).
- **Passphrase**: AES-GCM encryption with a key derived from a passphrase you set, using Argon2id (a memory-hard key-derivation function) or PBKDF2 on devices that cannot run Argon2id. Works on every platform including mobile, the keys stay on the device (stored encrypted in `secrets.json.nosync`), and the blob is portable across devices (you re-enter the passphrase to unlock on each one). When you set a passphrase the plugin enforces a minimum strength and offers a one-click generator that produces a strong 6-word passphrase. On devices where Obsidian secret storage is unavailable, setting a passphrase is required before any key can be saved.

If you use **passphrase mode** and do not want the encrypted key file copied around, **you can exclude `secrets.json.nosync` from any vault sync mechanism** and enter keys once per device. Configure the exclusion **before the first sync**, since files already uploaded usually remain on the remote. (In Obsidian secret storage mode this file holds no keys, so excluding it has no effect on the keys themselves.)

The path to exclude is always:

```
.obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
```

### Obsidian Sync (official)

Obsidian Sync excludes folders, not individual files (Settings, Sync, Excluded folders). You have two options:

- Exclude the entire `.obsidian/plugins/rewrite-voice-notes` folder and accept that you will lose template/profile sync (`data.json` lives there too).
- Or sync the folder and accept that the encrypted `secrets.json.nosync` blob will be uploaded; on other devices it will fail to decrypt and the plugin will treat it as no key set, prompting you to enter the key again.

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

If you have already committed it:

```bash
git rm --cached .obsidian/plugins/rewrite-voice-notes/secrets.json.nosync
git commit -m "remove rewrite-voice-notes secrets from tracking"
```

### Dropbox

Dropbox has no ignore-file mechanism. Use Selective Sync:

1. Open the Dropbox desktop app.
2. Preferences, Sync, Selective Sync.
3. Deselect the `rewrite-voice-notes` plugin folder, or use file-level exclusions if your Dropbox plan supports them.

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

- **Screen-off during recording**: mobile WebViews suspend (and stop `MediaRecorder` capture) when the screen sleeps. To counter this, the plugin holds a screen wake lock for the duration of an active recording on both iOS and Android, so screen-off mid-recording is largely mitigated on supported OS versions. It is best-effort: on older WebViews, in an insecure context, or if the OS denies the request, it silently falls back to the old behavior, so keeping the screen on (or using the Paste tab with an OS-level dictation keyboard) is still the safe habit.
- **Mobile encryption**: if your Obsidian version provides secret storage on mobile (1.11.4 or later), keys use it just like on desktop. Otherwise the plugin prompts you to set a passphrase before any key can be saved, and keys are then encrypted with Argon2id/PBKDF2 AES-GCM. The `secrets.json.nosync` file (which holds encrypted keys only in passphrase mode) uses the `.nosync` filename so iCloud Drive will skip it; for other sync tools, apply the exclusion rules above.
- **Recording size limit**: each transcription provider enforces its own ceiling (OpenAI Whisper and Groq are the tightest at 25 MB; AssemblyAI, Deepgram, and Rev.ai allow gigabytes). These are provider-API limits, not Obsidian ones, and are most likely to bite on long mobile recordings with the 25 MB providers.

## Known limitations (v1)

- No audio playback or waveform display.
- LLM responses are not streamed; you see the cleaned output once the whole response arrives.
- No long-audio chunking; clips that exceed the active provider's size or duration limit error out instead of being split.
- The OpenAI-compatible transcription endpoint expects a server that mirrors Whisper's `/v1/audio/transcriptions` shape (whisper.cpp, faster-whisper-server). The OpenAI-compatible LLM endpoint expects a `/chat/completions` shape (Ollama, LM Studio, etc.).
- Anthropic Claude calls go through Obsidian's `requestUrl`, which bypasses browser CORS. If you reuse the same endpoint from another tool that uses `fetch`, you will need their browser-direct-access header.

## Acknowledgements

- [Magic Mic](https://github.com/drewmcdonald/obsidian-magic-mic) by Drew McDonald (MIT, archived): originator of the MIME-type fallback and `MediaRecorder` patterns this plugin borrows.
- [Scribe](https://github.com/Mikodin/obsidian-scribe) by Mike Alicea: prior art for the record, transcribe, cleanup, and templated-insert flow inside Obsidian.
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin): the scaffold this repository was built on.

## License

MIT. See [LICENSE](LICENSE).
