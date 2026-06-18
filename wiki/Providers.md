# Providers

ReWrite separates transcription (audio to text) from cleanup (text to structured note). Each profile has one transcription slot and one LLM slot, with their own keys. This page covers choosing and configuring providers, models, diarization, context hints, and known nouns.

For fully local setups, see [Self-hosting: whisper.cpp](Self-Hosting-Whisper) and [Self-hosting: local and remote LLMs](Self-Hosting-LLMs).

## Transcription providers

| Provider | API key | Model dropdown | Diarization | Notes |
| --- | --- | --- | --- | --- |
| OpenAI Whisper (`openai`) | Yes | Yes | No | 25 MB upload cap. |
| OpenAI-compatible (`openai-compatible`) | Yes | No (type the id) | No | For self-hosted Whisper-shape servers; see base URL below. |
| Groq (`groq`) | Yes | Yes | No | 25 MB upload cap. |
| AssemblyAI (`assemblyai`) | Yes | No (docs link) | Yes | Large ceiling (5 GB / 10 h). |
| Deepgram (`deepgram`) | Yes | No (docs link) | Yes | 2 GB cap. |
| Rev.ai (`revai`) | Yes | No (docs link) | Yes | 2 GB / 17 h. |
| Mistral Voxtral (`mistral-voxtral`) | Yes | Yes (filtered) | No | Always transcodes to WAV; 30-minute cap. |
| Local whisper.cpp (`whisper-local`) | No | No | No | Desktop only, on-device. See [whisper.cpp](Self-Hosting-Whisper). |
| None (`none`) | n/a | n/a | n/a | Disables recording for text-only use. |

## LLM providers

| Provider | API key | Model dropdown | Notes |
| --- | --- | --- | --- |
| Anthropic Claude (`anthropic`) | Yes | Yes | Calls go through Obsidian's `requestUrl` (no browser CORS). |
| OpenAI GPT (`openai`) | Yes | Yes | Reasoning models (o-series, gpt-5) handled automatically. |
| OpenAI-compatible (`openai-compatible`) | Yes | No (type the id) | Cloud or local; base URL must include the version path. |
| Google Gemini (`gemini`) | Yes | Yes | Silently clamps overlong output rather than erroring. |
| Mistral (`mistral`) | Yes | Yes | |
| None (`none`) | n/a | n/a | Skips cleanup; inserts the raw transcript. |

## API keys

Keys are stored per profile (one transcription, one LLM), encrypted at rest. The desktop and mobile profiles keep their own keys even when both use the same provider. See [Secrets and sync](Secrets-and-Sync).

## Choosing a model

The model field adapts to the provider:

- **Providers that support listing models** (OpenAI, Groq, Anthropic, Gemini, Mistral, Deepgram, Mistral Voxtral) show a **dropdown** once you click **Refresh** to fetch the catalog your key can access. The dropdown has a **"Custom..."** option to type an id that is not in the list, and a "Back to list" button to return.
- **Providers without listing** (`openai-compatible`, AssemblyAI, Rev.ai) show a **plain text field**. For AssemblyAI and Rev.ai the field links to the provider's model docs; for `openai-compatible` there is no list because the catalog is your own server's.

Whatever the control, the value saved is the model id sent to the provider.

## Maximum note length (output cap)

"Maximum note length" frames the LLM's output-token cap in minutes of speech. If the cap is set higher than a model's own output ceiling, OpenAI and Anthropic return a friendly error pointing back at this setting; Gemini silently truncates instead. The Advanced "LLM max tokens" field edits the same value raw.

## OpenAI-compatible base URLs

There is an intentional asymmetry between the two sides; do not normalize one to the other:

- **Transcription** appends `/v1/audio/transcriptions` to a **root** URL. Enter `http://localhost:8080` (no `/v1`).
- **LLM** appends `/chat/completions` to a URL that **already includes** `/v1`. Enter `http://localhost:11434/v1` (with `/v1`).

This is why a local Ollama LLM uses `http://localhost:11434/v1` while a local Whisper-shape transcription server uses its root URL. See [Self-hosting: local and remote LLMs](Self-Hosting-LLMs) for Ollama specifics.

### Cloud OpenAI-compatible LLMs

Many cloud LLM services speak the same `/chat/completions` dialect, so they work through the **OpenAI-compatible** LLM provider with no first-class entry. Set the provider, paste a base URL (including its version path), type a model id, and enter your key.

| Provider | LLM base URL | Example models |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| Kimi (Moonshot) | `https://api.moonshot.ai/v1` | `kimi-k2-0905-preview`, `moonshot-v1-32k` |
| Qwen (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-max`, `qwen-plus` |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` |

The URLs above are international endpoints; China-region accounts can substitute mainland endpoints (for example `https://api.moonshot.cn/v1`, `https://dashscope.aliyuncs.com/compatible-mode/v1`).

## Speaker diarization

Diarization adds `Speaker A:` / `Speaker B:` labels and is supported only on **AssemblyAI**, **Deepgram**, and **Rev.ai**. Two switches raise the effective setting:

- The per-profile **Identify speakers** toggle (Settings).
- A per-template `diarize: true` flag (the Meeting transcript default ships with it). The flag only ever raises the setting; it is a documented no-op on providers that cannot diarize.

The labels survive cleanup because the shared core instructs the LLM to preserve them.

## Context hint

A per-run free-text field for one-off background (speakers, setting, subject), for example "Lecture by Dr. Smith on thermodynamics". It is the situational counterpart to the persistent known-nouns list and pairs naturally with diarization (mapping `Speaker X:` labels to real names). It is shown only for templates with `enableContextHint: true`, in the main modal and the reprocess picker. The cleanup step treats it as reference, not instructions.

## Known nouns

`ReWrite/KnownNouns.md` lists proper nouns the LLM should preserve verbatim, one per line, with optional misheard variants (`Hoxhunt: hawks hunt, hocks hunt`). When non-empty, the list is injected into the cleanup prompt. The file's frontmatter is human guidance only and is never sent to the LLM. Keep the list short; every entry costs tokens on every run.

## Per-provider recording limits

The plugin validates a recording against the provider's documented ceiling before sending, with a friendly error if it is too large:

- `openai` / `groq`: 25 MB
- `assemblyai`: 5 GB / 10 h
- `deepgram`: 2 GB
- `revai`: 2 GB / 17 h
- `mistral-voxtral`: 1 GB / 30 min
- `openai-compatible` / `whisper-local`: no client-side cap

[Back to Home](Home)
