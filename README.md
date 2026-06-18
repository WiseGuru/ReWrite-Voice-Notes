# ReWrite (Voice Notes)

An Obsidian plugin that captures speech (live recording or pasted transcript), runs it through a transcription provider, cleans and structures it with an LLM, and inserts the result into your vault.

You bring your own provider keys. Nothing is sent to a ReWrite server; the plugin only talks to the endpoints you configure. It can also run entirely on-device: pair the plugin-managed whisper.cpp transcription with a local OpenAI-compatible LLM (Ollama or llama.cpp) and no audio or text ever leaves your machine.

## Highlights

- Record in Obsidian, or paste and reprocess existing audio, then clean and structure it with an LLM and insert it into your vault.
- Bring-your-own keys across 8 transcription and 5 LLM providers, cloud or fully local; nothing goes to a ReWrite server.
- 10 editable Markdown templates (general cleanup, todo, daily note, meeting, lecture, podcast, guides, book log, and more) plus a shared-core baseline you edit once.
- Speaker diarization, saved-audio embeds, spoken ad-hoc instructions, known-nouns preservation, and per-run destination overrides.
- API keys encrypted at rest (OS secret storage, or an Argon2id/PBKDF2 passphrase) on desktop and mobile.

## Quick start

### 1. Install

**Community plugins (recommended):** in Obsidian, Settings, Community plugins (Restricted mode off), Browse, search "ReWrite (Voice Notes)", Install, Enable.

**Manual install:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/WiseGuru/ReWrite-Voice-Notes/releases), drop them into `<YourVault>/.obsidian/plugins/rewrite-voice-notes/`, then enable the plugin in Community plugins.

### 2. Configure a provider

Open Settings, ReWrite (Voice Notes). Configure the profile active on this device: pick a transcription provider (audio to text) and an LLM provider (cleanup), enter the API keys, and choose a model for each. The first key you save sets up encryption at rest. Text-only? An LLM alone is enough.

### 3. Populate templates

In Settings, Templates, click **Populate**. This seeds `ReWrite/Templates/` with 10 starter templates, plus `SharedCore.md`, `AssistantPrompt.md`, and `KnownNouns.md`. It is non-destructive. The template format is documented in [Creating templates](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Creating-Templates).

### 4. Create your first note

Click the **mic ribbon icon** (or run the **Open** command), pick the **Daily note** template, then **Record** your voice or **Paste** a transcript. The plugin transcribes, cleans the text, and writes a new dated note (Calendar / Goals / Tasks pulled out, then a Braindump). Recorded audio is saved to your attachments folder and linked back with an `![[...]]` embed.

The full step-by-step, including faster capture and reprocessing existing audio, is in the [Quick start](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Quick-Start) wiki page.

## Tested providers

"Tested" means a maintainer has run the full record/transcribe/cleanup/insert flow against that service. "Untested" means the adapter is implemented to the provider's documented API shape but not yet verified against a live account (unverified, not broken). For setup of each, see [Providers](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Providers).

| Transcription | Status | | LLM (cleanup) | Status |
| --- | --- | --- | --- | --- |
| Local whisper.cpp (plugin-managed) | ✅ Tested | | Anthropic Claude | ✅ Tested |
| Mistral Voxtral | ✅ Tested | | Mistral | ✅ Tested |
| AssemblyAI | ✅ Tested | | OpenAI-compatible (Ollama, LM Studio) | ✅ Tested (local Ollama) |
| OpenAI Whisper | Untested | | OpenAI GPT | Untested |
| OpenAI-compatible (whisper.cpp) | Untested | | Google Gemini | Untested |
| Groq | Untested | | DeepSeek / Kimi / Qwen / GLM | Untested |
| Deepgram | Untested | | | |
| Rev.ai | Untested | | | |

## Documentation

Full documentation lives in the [wiki](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki):

- [Quick start](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Quick-Start) - install to first note.
- [Settings reference](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Settings-Reference) - every setting, section by section.
- [Commands and menus](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Commands-and-Menus) - command palette, ribbon, menus, Quick Record.
- [Creating templates](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Creating-Templates) - the template format and a full authoring guide.
- [Providers](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Providers) - providers, models, diarization, context hints, known nouns, limits.
- [Self-hosting: whisper.cpp](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Self-Hosting-Whisper) - on-device transcription.
- [Self-hosting: local and remote LLMs](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Self-Hosting-LLMs) - Ollama / llama.cpp, locally or remote, with model picks.
- [Secrets and sync](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Secrets-and-Sync) - key encryption and excluding `secrets.json.nosync` from each sync tool.
- [Mobile](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Mobile) - iOS/Android differences.
- [Troubleshooting](https://github.com/WiseGuru/ReWrite-Voice-Notes/wiki/Troubleshooting) - triage for common problems.

These pages are maintained in the [`wiki/` folder](wiki/) of this repo and mirrored to the GitHub Wiki automatically.

## Known limitations

- No audio playback or waveform display.
- LLM responses are not streamed; you see the cleaned output once the whole response arrives.
- No long-audio chunking; clips that exceed the active provider's size or duration limit error out instead of being split.
- Anthropic Claude calls go through Obsidian's `requestUrl`, which bypasses browser CORS.

## Vault access

ReWrite lists the files in your vault for two features: finding audio files you can reprocess, and falling back to your most recently edited note when you run an insert with no editor open. It uses these listings for file paths only; it never reads a note's contents except the specific note or selection you act on, and it only writes the notes (and saved-audio attachments) produced by a run you trigger.

## Acknowledgements

- [Magic Mic](https://github.com/drewmcdonald/obsidian-magic-mic) by Drew McDonald (MIT, archived): originator of the MIME-type fallback and `MediaRecorder` patterns this plugin borrows.
- [Scribe](https://github.com/Mikodin/obsidian-scribe) by Mike Alicea: prior art for the record, transcribe, cleanup, and templated-insert flow inside Obsidian.
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin): the scaffold this repository was built on.

## License

0BSD. See [LICENSE](LICENSE).
