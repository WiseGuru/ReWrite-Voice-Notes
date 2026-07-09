# Settings reference

This page walks through every section of the plugin's settings tab (Settings, ReWrite (Voice Notes)), top to bottom. For provider-specific guidance see [Providers](Providers); for the local whisper server see [Self-hosting: whisper.cpp](Self-Hosting-Whisper).

## API key encryption

Controls how your provider API keys are encrypted at rest. There is no unencrypted option.

- **Encryption mode**: choose between **Obsidian secret storage** (the default when your Obsidian version and OS support it; keys live in the OS keychain) and **Passphrase** (AES-GCM with a key derived from a passphrase via Argon2id, or PBKDF2 where Argon2id is unavailable). Switching here changes the *active* method only and **does not move your keys** (the two methods can hold keys at once).
- **Copy keys from &lt;other method&gt;**: duplicates the keys saved under the inactive method into the active one, leaving the originals in place. Shown only when the other method has keys; you confirm the copy (and enter the passphrase when copying from the passphrase store), and a notice reports the count.
- **Clear keys in &lt;method&gt;**: permanently deletes the keys saved under the selected method, behind a confirmation. Shown only when that method has keys.
- **Change passphrase**: set or rotate the passphrase (passphrase mode only). The plugin enforces a minimum strength and offers a one-click 6-word generator.
- **Lock now**: clears the derived key from memory (passphrase mode). The next pipeline run prompts you to unlock.

Full detail, including which file holds what and how to keep keys off your sync, is on [Secrets and sync](Secrets-and-Sync).

## Active profile

- **Profile selection**: pick which profile is active. The plugin ships two profiles, **Desktop** and **Mobile**, so a device can use different providers and keys. Each device auto-detects which profile applies; this setting lets you override that.

## Profiles (Desktop and Mobile)

Each profile is rendered in its own framed section, with the device's active profile highlighted. It is split into three headed subsections (**Transcription**, **Real-time transcription**, **Post-processing (LLM)**) that all share the same field order: provider, base URL (where applicable), API key, then model. The fields:

- **Profile label**: a friendly name for the profile.

**Transcription** (batch, whole-file):

- **Transcription provider**: the service that turns audio into text. Choosing a provider reveals the fields it needs. `None` disables the recording paths for this profile (text-only use). See [Providers](Providers) for the full list.
- **Transcription base URL**: shown only for providers that need it (for example `openai-compatible`). See [Providers](Providers) for the base-URL conventions.
- **Transcription API key**: stored encrypted (see API key encryption above). Not shown for providers that need no key (such as local whisper.cpp).
- **Transcription model**: the adaptive model field described below.
- **Speaker diarization** is not a setting here: it is chosen per recording via an **Identify speakers** checkbox in the main modal (shown only for AssemblyAI / Deepgram / Rev.ai), defaulting to the template's `diarize` flag. See [Providers](Providers).

**Real-time transcription** (live dictation), configured independently of the batch provider so live dictation can use a different service. See [Providers](Providers):

- **Real-time provider**: None, or a streaming-capable provider (AssemblyAI / Deepgram). None disables it. (Voxtral real-time is not offered; see [Voxtral real-time (beta)](Voxtral-Realtime) for why.)
- **Real-time API key**: stored encrypted, separate from the batch key.
- **Real-time model**: the adaptive model field described below (a dropdown with Refresh for Deepgram, a text field for AssemblyAI). Often different from the batch model.

**Post-processing (LLM)**, the model that cleans and structures the transcript:

- **LLM provider**: `None` skips cleanup and inserts the raw text.
- **LLM base URL**: shown for `openai-compatible`. Note the base-URL asymmetry between transcription and LLM described in [Providers](Providers).
- **LLM API key**: stored encrypted.
- **LLM model**: the adaptive model field described below.
- **Maximum note length**: a friendly dropdown that frames the LLM output cap in minutes of speech (5 / 10 / 20 / 30 / 60). Internally this sets the LLM max-tokens value. A custom token value entered in Advanced shows here as a "Custom" option.

The **model** field in each section is a single adaptive control: when the provider supports listing models and the cache is populated, it is a dropdown with a Refresh button and a "Custom..." escape hatch for typing an id by hand; otherwise it is a plain text field. Whichever is shown, the value is the model id sent to the provider. See [Providers](Providers) for which providers support the dropdown.

- **Advanced** (collapsible):
  - **Transcription language**: an optional language hint passed to the transcription provider.
  - **LLM max tokens**: the raw output-token cap that "Maximum note length" frames in minutes. Editing it here updates the dropdown on the next render. The cap bounds output (note length), not input.

## Local whisper.cpp server (desktop)

Shown on desktop only. Manages a whisper-server binary you supply for fully on-device transcription. Fields: **Binary path**, **Model path**, **Port** (default 8080), **Extra args**, and a live **Status** row with Start/Stop and a log viewer. The server is always bound to loopback (`127.0.0.1`); it refuses to start if Extra args contains a non-loopback `--host`. Full walkthrough on [Self-hosting: whisper.cpp](Self-Hosting-Whisper).

Two lifecycle options, both off by default:

- **Start automatically**: starts the server when Obsidian opens, if this device's profile uses local whisper.cpp. A server still running from a previous session is adopted rather than doubled up.
- **Stop when idle**: minutes without a transcription before the server is stopped, freeing the model's memory (useful if you load a large model like large-v3 and do not want 1.5 GB resident all day). `0` keeps it running. Only servers started or adopted by ReWrite are stopped, never one you started yourself, and never in the middle of a transcription.

## Templates

- **Templates folder**: where the template Markdown files live (default `ReWrite/Templates`). Changing it reloads templates from the new location.
- **Populate or update default templates**: three buttons sharing one row:
  - **Populate**: creates any missing default templates plus `SharedCore.md`. Non-destructive; skips anything that already exists. (The template format is documented in [Creating templates](Creating-Templates), not a seeded vault file.)
  - **Update**: reconciles your default-derived templates against the current built-ins with a per-field 3-way merge, and writes a `Template update report.md` for anything it cannot safely auto-merge. Recreates any default you deleted.
  - **Load prior versions**: drops earlier shipped versions of the defaults into the folder as separate, selectable templates so you can compare wording.
- **Manage built-in templates** (collapsible): one row per built-in default with two labelled controls. The **Enabled** switch turns the default off: its file is removed (behind a confirmation) and neither Populate nor Update will ever re-add it, even after plugin updates; turn it back on to get a fresh copy. The **Tracked** checkbox governs updates: unchecking it writes `managed: false` into the file's frontmatter so Update never touches it again (you have adopted it as your own). See [Creating templates](Creating-Templates) for the `managed` flag.
- **Default template**: the template pre-selected when you open the modal.
- **Quick record (set template)**: the template used by the "Quick record (set template)" command (see [Commands and menus](Commands-and-Menus)).
- **On filename collision**: when a `newFile` template would overwrite an existing note, either `auto` (silently append `-1`, `-2`, ...) or `prompt` (ask you for a name).

See [Creating templates](Creating-Templates) for the file format and how Populate / Update / Load prior versions differ.

## Recording

- **Audio format preference**: a hint for which container/codec MediaRecorder should prefer; the plugin falls back to a supported format if the preferred one is unavailable.
- **Attachments folder**: where recorded audio is saved. Leave empty to use Obsidian's own attachment location; set a folder to override it. Saved recordings are linked into the output with an `![[...]]` embed.

The main modal's Record tab also has a **Record in background** checkbox (desktop only, remembered across sessions): when checked, pressing Record closes the modal and hands the capture to the Quick Record floating bar, carrying the template, destination, and context you set up in the modal, so you can keep using Obsidian while recording. See [Commands and menus](Commands-and-Menus).

## Auto-ingest folders

Semi-automatic batch processing for audio captured outside Obsidian (a voice-recorder app, a call-recording export, a scripted dump) and dropped into a vault folder.

- Each **rule** pairs a vault folder with a template; rules are created and edited in a popup (**Add ingest folder**). Only templates that create a new file are offered, so every recording predictably becomes its own note where the template says. Rules can be toggled, edited, or deleted from the list.
- Nothing watches the folder. You run the **Process auto-ingest folders** command when you want a batch processed; that is the whole trigger.
- Files are processed one at a time. On success, the recording is **moved** to your attachments location (the note's audio link is updated automatically), which is also what prevents it from being processed twice. A file that fails stays in the folder and is retried the next time you run the command.
- Only files directly in the folder are scanned, not subfolders. Works on desktop and mobile.

## Ad-hoc instructions

Controls spoken "assistant" instructions extracted from a transcript (say the assistant name followed by a directive, and that directive is injected into the cleanup prompt).

- **Enabled**: turns the feature on or off.
- **Assistant name**: the trigger word the extractor listens for (the vocative, for example "Scribe, make this a bulleted list").
- **Assistant prompt file**: the vault Markdown file whose body is prefaced above extracted directives (default `ReWrite/AssistantPrompt.md`).
- **Populate default assistant prompt**: writes the default prompt file if missing.

## Shared core

The baseline cleanup rules prepended to every template prompt (unless a template opts out). A status badge shows whether it is currently enabled (the file exists and is non-empty).

- **Shared core file**: the vault Markdown file used (default `ReWrite/SharedCore.md`). Delete or empty it to disable the shared core globally.
- **Re-create shared core file**: writes the default shared core if missing.

See [Creating templates](Creating-Templates) for how the shared core combines with a template at run time.

## Known nouns

Proper nouns the LLM should preserve verbatim (with optional misheard variants).

- **Known nouns file**: the vault Markdown file used (default `ReWrite/KnownNouns.md`). Its frontmatter is human-guidance only and is never sent to the LLM; only the body lines are used.
- **Populate default known nouns**: writes the default file (with example entries) if missing.

[Back to Home](Home)
