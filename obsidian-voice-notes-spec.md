# Obsidian Voice Notes Plugin: Development Spec

## Overview

A plugin for Obsidian that transcribes speech into notes, then uses an LLM to clean up and
structure the output. Supports two input modes (record audio directly, or paste pre-transcribed
text) and user-defined note templates with custom prompts per template.

Provider selection for both transcription and LLM cleanup is fully configurable. The plugin
auto-selects a provider profile based on whether it is running on desktop or mobile, with manual
override available in settings.

---

## Deliverables

- A complete, installable Obsidian plugin written in TypeScript
- A working build pipeline (`esbuild`)
- A README with install, setup, and usage instructions

---

## Plugin Architecture

```
obsidian-voice-notes/
├── src/
│   ├── main.ts                        # Plugin entry point
│   ├── settings.ts                    # Settings tab and data types
│   ├── recorder.ts                    # Audio recording via MediaRecorder API
│   ├── modal.ts                       # Main UI modal (record / paste / template select)
│   ├── types.ts                       # Shared interfaces
│   ├── transcription/
│   │   ├── index.ts                   # TranscriptionProvider interface + factory
│   │   ├── openai.ts                  # OpenAI Whisper + OpenAI-compatible endpoints
│   │   ├── groq.ts                    # Groq (OpenAI-compatible preset)
│   │   ├── assemblyai.ts              # AssemblyAI (distinct API format)
│   │   ├── deepgram.ts                # Deepgram (distinct API format)
│   │   ├── revai.ts                   # Rev.ai (distinct API format)
│   │   └── webspeech.ts               # Web Speech API (browser-native, no key)
│   └── llm/
│       ├── index.ts                   # LLMProvider interface + factory
│       ├── anthropic.ts               # Anthropic Claude (native format)
│       ├── openai.ts                  # OpenAI GPT + OpenAI-compatible endpoints
│       ├── gemini.ts                  # Google Gemini (distinct API format)
│       └── mistral.ts                 # Mistral (OpenAI-compatible preset, named for UX)
├── styles.css
├── manifest.json
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

---

## Provider System

### Core Interfaces

Both transcription and LLM cleanup use the same adapter pattern.

```typescript
// Transcription
interface TranscriptionProvider {
  transcribe(audio: Blob, config: TranscriptionConfig): Promise<string>;
}

// LLM cleanup
interface LLMProvider {
  complete(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<string>;
}
```

The factory functions in `transcription/index.ts` and `llm/index.ts` take a provider config
object and return the correct concrete implementation. No provider-specific logic leaks outside
its own file.

### Transcription Providers

| Provider ID | Format | Auth | Notes |
|---|---|---|---|
| `openai` | OpenAI Whisper | API key | `POST /v1/audio/transcriptions`, model `whisper-1` |
| `openai-compatible` | OpenAI Whisper | API key + base URL | For local servers: whisper.cpp, faster-whisper-server, etc. |
| `groq` | OpenAI-compatible preset | API key | Base URL `https://api.groq.com/openai/v1`; model `whisper-large-v3-turbo` |
| `assemblyai` | AssemblyAI | API key | Upload then poll; see adapter notes below |
| `deepgram` | Deepgram | API key | `POST https://api.deepgram.com/v1/listen`; distinct format |
| `revai` | Rev.ai | API key | Submit job then poll; see adapter notes below |
| `webspeech` | Web Speech API | None | Browser-native; desktop fallback and mobile default |

**Groq and `openai-compatible` are both the OpenAI format.** Groq is a named preset
(pre-filled base URL and default model) so users can select it by name rather than entering
the URL manually. The underlying adapter code is shared with `openai`.

**AssemblyAI and Rev.ai are async (submit + poll).** Both require:
1. POST audio to get a job/transcript ID
2. Poll the status endpoint until complete or failed
3. Return the transcript text

Implement polling with exponential backoff, max 60 seconds, then surface a timeout error.

**Web Speech API** uses the browser's `SpeechRecognition` / `webkitSpeechRecognition`. It does
not produce an audio blob; instead it streams results live. The recorder tab should handle this
as a special case: when Web Speech is the active transcription provider, the "Record" button
starts a `SpeechRecognition` session and the raw transcript populates directly into the pipeline
without a separate transcription API call.

**`openai-compatible` base URL** should include a text input in settings for the server address
(default `http://localhost:8080`). This covers whisper.cpp's built-in server, faster-whisper-server,
and any other Whisper-compatible local server.

### LLM Cleanup Providers

| Provider ID | Format | Auth | Notes |
|---|---|---|---|
| `anthropic` | Anthropic Messages API | API key | Native format; see request shape below |
| `openai` | OpenAI Chat Completions | API key | `POST /v1/chat/completions` |
| `openai-compatible` | OpenAI Chat Completions | API key + base URL | Covers Ollama, LM Studio, any compatible server |
| `gemini` | Google Gemini | API key | `POST .../generateContent`; distinct format |
| `mistral` | OpenAI-compatible preset | API key | Base URL `https://api.mistral.ai/v1`; named for discoverability |

**Mistral is a named preset over the OpenAI-compatible adapter**, identical to Groq on the
transcription side. The underlying adapter code is shared with `openai`. It gets its own entry
in the provider dropdown so users do not have to know the base URL.

**`openai-compatible` base URL** for LLM should similarly accept a configurable URL
(default `http://localhost:11434/v1` for Ollama). LM Studio uses `http://localhost:1234/v1`.
The settings field should show these as placeholder hint text.

---

## Environment Profiles

### Auto-Detection

On plugin load, detect the platform using Obsidian's `Platform` utility:

```typescript
import { Platform } from 'obsidian';
const isDesktop = Platform.isDesktop; // true on Electron desktop builds
```

Activate the Desktop profile if `isDesktop` is true, otherwise activate the Mobile profile.
The user can override the active profile manually from the settings tab.

### Profile Structure

Each profile stores independent provider selections and credentials. Model selection within
each provider is also per-profile.

```typescript
interface EnvironmentProfile {
  name: string;                          // "Desktop" or "Mobile" (user-editable label)
  transcriptionProvider: TranscriptionProviderID;
  transcriptionConfig: TranscriptionConfig;  // API key, base URL, model, language
  llmProvider: LLMProviderID;
  llmConfig: LLMConfig;                  // API key, base URL, model, max_tokens
}
```

### Default Profile Values

**Desktop (default):**
- Transcription: `openai`, model `whisper-1`
- LLM: `anthropic`, model `claude-sonnet-4-20250514`

**Mobile (default):**
- Transcription: `webspeech` (no API key needed)
- LLM: `anthropic`, model `claude-sonnet-4-20250514`

Users can change any of these. The defaults are just what ships out of the box.

### Global Defaults with Per-Profile Overrides

API keys are stored globally (entered once, shared across profiles) since most users will use
the same account on all devices. Each profile can override any key if needed (e.g. a
separate Anthropic key for a shared workstation).

```typescript
interface GlobalSettings {
  apiKeys: Record<ProviderID, string>;   // Global fallback keys
  activeProfileOverride: 'auto' | 'desktop' | 'mobile';
  desktopProfile: EnvironmentProfile;
  mobileProfile: EnvironmentProfile;
  defaultTemplate: string;
  recordingFormat: 'webm' | 'mp4';
  templates: NoteTemplate[];
}
```

If a profile's `transcriptionConfig.apiKey` or `llmConfig.apiKey` is empty, fall back to
`globalSettings.apiKeys[providerID]`.

---

## Feature Spec

### 1. Input Modes

The plugin presents a modal when triggered. The modal has two tabs:

**Tab A: Record Audio**
- "Record" button starts capturing mic audio via `MediaRecorder` (or starts a `SpeechRecognition`
  session when the active transcription provider is `webspeech`)
- Recording indicator (pulsing dot + elapsed timer) shown while active
- "Stop" ends the recording and passes the audio blob (or Web Speech transcript) into the pipeline
- Show distinct progress labels: "Transcribing..." then "Cleaning up..."

**Tab B: Paste Text**
- Plain textarea for pre-transcribed text
- "Clean Up" passes text directly to the LLM cleanup step
- Primary path on mobile; also useful when using OS-level STT (Gboard, iOS keyboard, etc.)

### 2. Template System

A "Note Template" dropdown appears in the modal above the input tabs.

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name in dropdown (e.g. "Daily Note") |
| `prompt` | string | System prompt sent to the LLM with the raw transcript |
| `insertMode` | enum | `cursor`, `newFile`, or `append` |
| `newFileFolder` | string | Folder path when `insertMode = newFile` |
| `newFileNameTemplate` | string | Filename template; supports `{{date}}` and `{{time}}` |

**Default templates shipped with the plugin:**

1. **General Cleanup**: Fix grammar, remove filler words, preserve the original structure and length.
2. **Todo List**: Output a markdown checkbox list (`- [ ]`). Group related items under subheadings.
3. **Daily Note**: Separate into sections with `##` headings: Goals, Notes, Meals, Dreams.
4. **Meeting Notes**: Sections for Attendees, Summary, Action Items, and Decisions.
5. **Idea Capture**: Preserve the raw ideas faithfully; prepend a single-sentence summary.

Users can edit, delete, add, and reorder templates in settings.

### 3. LLM Cleanup Step

After transcription (or paste), the raw text is sent to the active profile's LLM provider.
The selected template's `prompt` is the system prompt; the raw transcript is the user message.
Response is inserted per the template's `insertMode`.

**Insert modes:**
- `cursor`: Insert at the current editor cursor position
- `newFile`: Create a new file, open it
- `append`: Append to the currently active note

### 4. Settings Tab Layout

The settings tab should be organized into clear sections:

1. **Active Profile**: Show which profile is currently active (auto-detected or overridden).
   Dropdown to force Desktop / Mobile / Auto.

2. **Desktop Profile**: Transcription provider dropdown + provider-specific fields (API key,
   base URL if applicable, model name). LLM provider dropdown + same fields.

3. **Mobile Profile**: Same structure as Desktop Profile section.

4. **Global API Keys**: One password field per provider. Used as fallback when a profile does
   not have a key set. Label clearly: "Shared across profiles unless overridden above."

5. **Templates**: Full CRUD list with drag-to-reorder.

6. **Recording**: Format selector (`webm` / `mp4`).

API keys must never appear in `data.json` in plaintext. Use Obsidian's
`loadData` / `saveData` with the understanding that sensitive values should be stored via
`plugin.app.vault.adapter` or flagged clearly in the README as a known limitation if
Obsidian does not provide encrypted storage on a given platform.

### 5. Commands

| Command ID | Name | Behavior |
|---|---|---|
| `voice-notes:open-modal` | Voice Notes: Open | Opens modal with last-used template |
| `voice-notes:quick-record` | Voice Notes: Quick Record | Starts recording immediately with default template, no modal |

---

## API Request Shapes

### Anthropic Claude

```
POST https://api.anthropic.com/v1/messages
x-api-key: {key}
anthropic-version: 2023-06-01
Content-Type: application/json

{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 2048,
  "system": "<template prompt>",
  "messages": [{ "role": "user", "content": "<raw transcript>" }]
}
```

Extract `response.content[0].text`.

### OpenAI / OpenAI-compatible / Mistral (same format)

```
POST {baseUrl}/v1/chat/completions
Authorization: Bearer {key}
Content-Type: application/json

{
  "model": "<configured model>",
  "messages": [
    { "role": "system", "content": "<template prompt>" },
    { "role": "user", "content": "<raw transcript>" }
  ]
}
```

Extract `response.choices[0].message.content`.

### Google Gemini

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
Content-Type: application/json

{
  "system_instruction": { "parts": [{ "text": "<template prompt>" }] },
  "contents": [{ "parts": [{ "text": "<raw transcript>" }] }]
}
```

Extract `response.candidates[0].content.parts[0].text`.

### OpenAI Whisper Transcription

```
POST https://api.openai.com/v1/audio/transcriptions   (or {baseUrl}/v1/audio/transcriptions)
Authorization: Bearer {key}
Content-Type: multipart/form-data

file: <audio blob>
model: whisper-1
response_format: text
```

### AssemblyAI

```
# Step 1: Upload audio
POST https://api.assemblyai.com/v2/upload
Authorization: {key}
Content-Type: application/octet-stream
Body: <audio blob>
→ returns { upload_url }

# Step 2: Request transcript
POST https://api.assemblyai.com/v2/transcript
Authorization: {key}
{ "audio_url": "<upload_url>" }
→ returns { id }

# Step 3: Poll
GET https://api.assemblyai.com/v2/transcript/{id}
Authorization: {key}
→ poll until status = "completed" or "error"
→ return transcript.text
```

### Deepgram

```
POST https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true
Authorization: Token {key}
Content-Type: audio/webm   (or audio/mp4)
Body: <audio blob>

→ response.results.channels[0].alternatives[0].transcript
```

### Rev.ai

```
# Step 1: Submit job
POST https://api.rev.ai/speechtotext/v1/jobs
Authorization: Bearer {key}
Content-Type: multipart/form-data
media: <audio blob>
→ returns { id }

# Step 2: Poll
GET https://api.rev.ai/speechtotext/v1/jobs/{id}
→ poll until status = "transcribed" or "failed"

# Step 3: Fetch transcript
GET https://api.rev.ai/speechtotext/v1/jobs/{id}/transcript
Authorization: Bearer {key}
Accept: text/plain
→ returns plain text
```

---

## Error Handling Requirements

- **No API key configured**: Show a Notice before any fetch; do not attempt the call
- **Mic permission denied**: Catch `getUserMedia` rejection; show actionable Notice
- **Transcription API error**: Surface the error message in a Notice; do not proceed to LLM
- **LLM API error**: Surface error; copy raw transcript to clipboard as fallback
- **AssemblyAI / Rev.ai poll timeout** (60s): Surface timeout error; preserve raw audio if possible
- **Empty transcript**: Do not call the LLM; show a Notice
- **Network offline**: Check before any fetch; surface clearly
- **Web Speech not supported**: If `webspeech` is configured but `SpeechRecognition` is
  unavailable in the current environment, show a Notice and suggest switching providers

---

## UI / UX Notes

- Keyboard-navigable modal (Tab, Enter for primary action)
- Distinct progress labels per pipeline stage: "Transcribing..." / "Cleaning up..."
- Keep modal open on error so the user can retry without re-recording
- Template prompt textarea in settings: min 6 rows
- Template list: drag-to-reorder
- Provider-specific fields in settings should show/hide based on the selected provider
  (e.g. base URL field only appears for `openai-compatible`; no key field for `webspeech`)
- Model name fields should be free-text inputs (not dropdowns) since model availability
  changes frequently and varies by account tier

---

## Build & Tooling

Use `esbuild` (not webpack):

- Bundle `src/main.ts` to `main.js` (CommonJS, no sourcemaps in production)
- Externalize `obsidian` and Node built-ins
- Support a `--watch` flag for development

`manifest.json`:

```json
{
  "id": "voice-notes",
  "name": "Voice Notes",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Record or paste speech and have it transcribed and structured by AI.",
  "author": "",
  "isDesktopOnly": false
}
```

`isDesktopOnly: false` is required for mobile support.

---

## Testing Checklist

> **Retired.** This list went stale (5 templates instead of 10, a removed `webspeech` provider, a flat 60 s poll timeout, a removed clipboard fallback). The live, kept-current manual verification pass is the **`release-checklist` skill** at [`.claude/skills/release-checklist/`](.claude/skills/release-checklist/) (`CHECKLIST.md` there is runnable standalone). See [docs/DEV_TOOLING.md](docs/DEV_TOOLING.md). Heading kept as a stable anchor.

---

## Out of Scope (v1)

- Audio playback or waveform visualization
- Saving raw audio files to the vault
- Multi-language transcription UI (Whisper supports `language` param but UI is v2)
- Streaming LLM responses (insert text as it arrives)
- Speaker diarization (AssemblyAI supports it but adds UI complexity)
- Sync of templates across devices (vault sync via `data.json` handles this automatically)

---

## Secrets Storage

### Design

API keys are stored in a separate `secrets.json.nosync` file inside the plugin folder, distinct from
`data.json`. This separation exists so users can exclude the secrets file from vault sync
without affecting their settings, templates, or profiles.

On desktop (Electron), keys are encrypted using Electron's `safeStorage` API before being
written to `secrets.json.nosync`. The encrypted blob is decrypted on read. `safeStorage` ties
encryption to the OS user account via the system keychain (Keychain on macOS, Credential
Manager on Windows, libsecret on Linux), so the blob is unreadable on any other machine or
user account even if the file is copied.

On mobile (or any environment where `safeStorage` is unavailable), keys are stored as plaintext.
The README must document this limitation clearly.

**Important:** `safeStorage` encryption is machine-specific. An encrypted blob from one desktop
cannot be decrypted on another desktop or on mobile. For this reason, `secrets.json.nosync` must never
be synced. Users enter their API keys once on each device.

### Implementation

```typescript
// src/secrets.ts
import { safeStorage } from 'electron';   // only available in Electron / desktop
import { Platform } from 'obsidian';

const SECRETS_FILE = 'secrets.json.nosync';

async function saveKey(plugin: Plugin, providerId: string, key: string): Promise<void> {
  const secrets = await loadSecrets(plugin);
  if (Platform.isDesktop && safeStorage.isEncryptionAvailable()) {
    secrets[providerId] = safeStorage.encryptString(key).toString('base64');
    secrets[`${providerId}_encrypted`] = true;
  } else {
    secrets[providerId] = key;
    secrets[`${providerId}_encrypted`] = false;
  }
  await plugin.app.vault.adapter.write(
    `${plugin.manifest.dir}/${SECRETS_FILE}`,
    JSON.stringify(secrets)
  );
}

async function loadKey(plugin: Plugin, providerId: string): Promise<string> {
  const secrets = await loadSecrets(plugin);
  const value = secrets[providerId] ?? '';
  if (secrets[`${providerId}_encrypted`] && Platform.isDesktop) {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }
  return value;
}
```

---

## README: Excluding secrets.json.nosync from Sync

The plugin README must include a dedicated section explaining that `secrets.json.nosync` should be
excluded from vault sync on every device, and providing exact instructions for each common
sync tool. The section should appear prominently, before the general usage instructions.

The path to exclude is always:

```
.obsidian/plugins/voice-notes/secrets.json.nosync
```

---

### Obsidian Sync (official)

Obsidian Sync can exclude specific folders via Settings → Sync → Excluded folders → Manage.
However, it excludes at the folder level only, not individual files. The recommended approach
is to configure this exclusion before syncing for the first time, since files already synced
remain in the remote vault even after being added to the exclusion list.

Since Obsidian Sync cannot exclude individual files, the workaround is to exclude the entire
plugin folder from sync and sync settings via a different mechanism, or accept that
`secrets.json.nosync` will be present in the remote vault but unreadable on other devices (because
`safeStorage` encryption is machine-specific). Document this limitation clearly.

---

### Syncthing

Create a file called `.stignore` in the root of the synced folder.
The `.stignore` file itself will never be synced to other devices.

Add this line:

```
.obsidian/plugins/voice-notes/secrets.json.nosync
```

Full example `.stignore` entry:

```
// Voice Notes plugin secrets - never sync API keys
.obsidian/plugins/voice-notes/secrets.json.nosync
```

A pattern beginning with `/` matches in the root of the synced folder only. If your
vault is not at the Syncthing folder root, omit the leading slash:

```
.obsidian/plugins/voice-notes/secrets.json.nosync
```

---

### Resilio Sync

The `IgnoreList` file is located in the hidden `.sync` folder inside your sync share.
Each line of the IgnoreList file represents a separate rule. IgnoreList supports `?` and `*` wildcard symbols.

Add this line to `.sync/IgnoreList`:

```
.obsidian/plugins/voice-notes/secrets.json.nosync
```

It is advisable, but not compulsory, to have the same IgnoreList on all peers. Add
the entry on every device that syncs the vault.

---

### GitHub / Git

Add to `.gitignore` in the vault root:

```gitignore
# Voice Notes plugin - never commit API keys
.obsidian/plugins/voice-notes/secrets.json.nosync
```

If you have already committed `secrets.json.nosync` by mistake, remove it from tracking:

```bash
git rm --cached .obsidian/plugins/voice-notes/secrets.json.nosync
git commit -m "remove voice-notes secrets from tracking"
```

---

### Dropbox

Dropbox has no ignore-file equivalent. Use Dropbox's selective sync feature:

1. Open the Dropbox desktop app
2. Go to Preferences → Sync → Selective Sync
3. Deselect the `voice-notes` plugin folder, or manage exclusions at the file level if your
   Dropbox version supports it

Alternatively, after setup on each device, delete `secrets.json.nosync` from Dropbox via the web
interface. The plugin will recreate it locally when you re-enter your keys.

---

### iCloud Drive

iCloud has no ignore-file mechanism; it cannot be told to skip specific files by pattern.
However, iCloud natively skips any file or folder whose name ends in `.nosync`. Because the
plugin uses `secrets.json.nosync` as its filename, iCloud will simply never upload it.
No configuration is needed on your part.

If you are storing your vault in iCloud Drive, this works automatically. No extra steps required.

---

### FolderSync (Android)

FolderSync supports exclude rules in each sync pair's settings. Add a file filter rule to
exclude `secrets.json.nosync`:

1. Open the sync pair for your vault
2. Go to Filters → Excluded files
3. Add the pattern: `secrets.json.nosync`


---

## Prior Art & Reference Code

This section documents existing plugins and sources that Claude Code should review before
implementing the recorder and Obsidian plumbing. The goal is to avoid reinventing solved
problems, especially around mobile audio edge cases.

### Plugins to Review

**Scribe (Mikodin/obsidian-scribe)**
The closest functional overlap with this plugin. Review for:
- Recorder implementation and pause/resume state machine
- Mobile edge case handling (iOS screen-off caveat: recording silently stops if the screen
  turns off; the plugin cannot work around this, but should document it clearly)
- How it structures the modal and ribbon icon registration
- Its `mimeType.ts` utility for MIME type detection across platforms

Note: Scribe borrowed its recorder implementation from Magic Mic (see below). Its
transcription and LLM code is hardcoded to OpenAI/AssemblyAI and should not be referenced
for our provider abstraction. Credited as prior art in the README.

**Magic Mic (drewmcdonald/obsidian-magic-mic)** - MIT licensed, now archived
The originator of the recorder pattern that both Scribe and this plugin can learn from.
Review for:
- MIME type priority list and `MediaRecorder.isTypeSupported()` fallback logic
- Long audio chunking strategy (splitting recordings that exceed API size limits, with
  prompt-seeding across chunks for transcription consistency)
- The `esbuild.config.mjs` setup, which is clean and directly usable as a starting point
- How it handles the OpenAI transcription hint/prompt parameter for proper nouns

Being MIT licensed and archived, its code can be referenced freely. Attribute in README.

**obsidian-better-audio-recorder (salmund)**
Minimal (~30kb) pause/resume recorder built purely on `MediaRecorder`. Good reference for
the simplest correct implementation of pause/resume without extra dependencies.

### Key Technical Notes Gathered from Research

**MIME type selection on iOS/Safari:**
Safari's `MediaRecorder` only supports `audio/mp4` (AAC in MP4 container). It does not
support `audio/webm`. The correct approach, documented in the WebKit MediaRecorder API blog:

```typescript
function getBestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus', // Chrome, Firefox, desktop Electron
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',              // Safari, iOS, Obsidian mobile on iPhone
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // let the browser choose
}
```

The empty-string fallback lets the browser use its default, which is always something
it can actually record. Never hardcode `audio/webm` without the `isTypeSupported` check.

**iOS screen-off caveat:**
On iOS, `MediaRecorder` silently stops capturing audio when the screen turns off. This is
an OS-level restriction that Obsidian cannot override. The plugin should:
1. Document this clearly in the README under a "Mobile Limitations" section
2. Show a Notice when the user first records on iOS suggesting they keep the screen on

**Long audio chunking:**
Whisper's API has a 25MB file size limit. For long recordings, the recorder should collect
`ondataavailable` chunks and either:
- Concatenate them and check size before sending (simplest, works for most voice notes)
- Split at chunk boundaries and make multiple transcription calls, prepending the last
  ~224 tokens of the prior response as a prompt to maintain consistency (Magic Mic's approach,
  worth adopting for robustness)

For the first implementation, concatenation with a size check and a Notice if the file
exceeds 25MB is acceptable. The multi-call chunking strategy is a v2 improvement.

**Pause/resume state:**
`MediaRecorder.pause()` and `MediaRecorder.resume()` are well-supported on desktop.
On mobile they may behave inconsistently. The state machine should track:
`idle → recording → paused → recording → stopped`
and guard every state transition explicitly rather than assuming the browser fires events
reliably.

### Attribution

The README should include an acknowledgements section:

```markdown
## Acknowledgements

- [Magic Mic](https://github.com/drewmcdonald/obsidian-magic-mic) by Drew McDonald (MIT):
  MIME type selection strategy and long-audio chunking approach informed our recorder
  implementation.
- [Scribe](https://github.com/Mikodin/obsidian-scribe) by Mike Alicea: prior art for the
  record-transcribe-cleanup-with-templates pattern in Obsidian.
- [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin): base
  project structure.
```
