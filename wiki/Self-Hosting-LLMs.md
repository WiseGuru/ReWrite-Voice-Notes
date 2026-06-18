# Self-hosting: local and remote LLMs

ReWrite's cleanup step works with any server that speaks the OpenAI `/chat/completions` dialect, through the **OpenAI-compatible** LLM provider. That covers Ollama, llama.cpp's `llama-server`, LM Studio, and most self-hosted gateways, whether on your own machine or a remote box.

Pair this with [local whisper.cpp](Self-Hosting-Whisper) so neither audio nor text leaves your machine.

## Running locally (Ollama)

[Ollama](https://ollama.com) is the easiest starting point on macOS, Linux, and Windows.

1. Install Ollama and start it (`ollama serve`, or it runs as a service).
2. Pull a model: `ollama pull llama3.2` (see the model picks below).
3. In a ReWrite profile, set **LLM provider** to "OpenAI-compatible (cloud or local)".
4. **LLM base URL**: `http://localhost:11434/v1`
5. **LLM model**: the pulled name, for example `llama3.2`.
6. **API key**: Ollama ignores it, so any non-empty placeholder works.

Note the `/v1`: for the LLM side the base URL **must include the version path**, because the adapter appends `/chat/completions` to whatever you enter. (The transcription side is different; see the base-URL asymmetry in [Providers](Providers).)

### llama.cpp

Run `llama-server -m <model.gguf>`. Base URL `http://localhost:8080/v1`, model = whatever name the server reports.

## Running on a remote / self-hosted server

The setup is the same; you just point the base URL at the remote host. The important part is **not** exposing the raw model port to the internet. Ollama's API has no authentication, so a public `11434` lets anyone use (and abuse) your GPU.

Recommended approaches, safest first:

1. **Private tunnel (best).** Keep the server bound to localhost and reach it over WireGuard, Tailscale, or an SSH tunnel (`ssh -L 11434:localhost:11434 user@host`). Then use `http://localhost:11434/v1` as if it were local. No public port at all.
2. **Reverse proxy with TLS and auth.** Put nginx or Caddy in front, terminate HTTPS, and require a token (bearer header) or basic auth. Bind Ollama to localhost and let only the proxy talk to it. Then the base URL is `https://your-host/v1` and you put the token in the API key field (for bearer) or in the URL/proxy config.
3. **Bind Ollama to the LAN only** (`OLLAMA_HOST=0.0.0.0:11434`) behind a firewall, for a trusted home network. Acceptable on an isolated LAN; never do this on a public IP without a proxy in front.

Do not expose Ollama's port directly to the public internet.

## Hardware and model picks

Running a model locally is more demanding than calling a cloud API: you need enough RAM (and ideally a GPU) to hold the model. The good news is that ReWrite's job (cleaning and lightly structuring a transcript) is undemanding, so small instruct-tuned models do it well. You do not need a 70B model to fix grammar and add headings.

Use 4-bit quantization (Ollama's default `Q4_K_M`) as a starting point and move to `Q5_K_M` only if quality falls short. RAM figures below are rough 4-bit estimates; a GPU with that much VRAM is faster, but CPU + system RAM works for short notes.

| Model | Params | ~RAM (4-bit) | Pull | Good for |
| --- | --- | --- | --- | --- |
| Llama 3.2 1B | 1B | ~2-3 GB | `ollama pull llama3.2:1b` | Lightest option; fine for cleanup on low-end laptops. |
| SmolLM2 1.7B | 1.7B | ~4 GB | `ollama pull smollm2:1.7b` | Fast, tiny, good for short notes. |
| Phi-4-mini | 3.8B | ~3-4 GB | `ollama pull phi4-mini` | Strong instruction-following in a small footprint; long context. |
| Llama 3.2 3B | 3B | ~6 GB | `ollama pull llama3.2` | A solid all-rounder; good default if unsure. |
| Gemma 3 4B | 4B | ~6 GB | `ollama pull gemma3:4b` | Good instruction-following from Google. |
| Qwen3 4B | 4B | ~6 GB | `ollama pull qwen3:4b` | Capable small model; strong at structure. |
| Qwen3 8B | 8B | ~8-10 GB | `ollama pull qwen3:8b` | Step up when you have the headroom. |
| Ministral 8B | 8B | ~10 GB | `ollama pull mistral:8b` | Competitive with larger models; needs more RAM. |

These are guidance, not gospel; model availability and tags move quickly, so check the [Ollama library](https://ollama.com/library) for current names. If a model feels too terse or ignores your template structure, step up a size or try `Q5_K_M`. (This list refreshes the older [MachineLearningMastery "Top 7"](https://machinelearningmastery.com/top-7-small-language-models-you-can-run-on-a-laptop/) roundup, which still cited Phi-3.5, Llama 3.2, Qwen 2.5, and Gemma 2.)

For a rule of thumb: 8 GB RAM comfortably runs a 3B-4B model; 16 GB opens up 7B-8B; below 8 GB, stick to 1B-2B.

## Troubleshooting

- **Connection refused / network error**: Ollama (or your server) is not running, or the host/port is wrong. Confirm `ollama serve` is up and that `http://localhost:11434/v1/models` responds in a browser or `curl`.
- **404 Not Found**: almost always the `/v1` path. The LLM base URL must end in `/v1` (Ollama) or the right version path; the adapter adds `/chat/completions`. A doubled `/v1/v1` also 404s.
- **Model not found**: the model id does not match a pulled model. Run `ollama list` and use the exact name (including the tag, for example `llama3.2:1b`).
- **Works locally but not from another device**: Ollama binds to localhost by default. Set `OLLAMA_HOST=0.0.0.0:11434` to listen on the LAN (behind a firewall), or use a tunnel/proxy as above.
- **CORS errors**: ReWrite calls go through Obsidian's `requestUrl`, which bypasses browser CORS, so this is rare. If a proxy enforces origins, set `OLLAMA_ORIGINS` appropriately on the server.
- **Very slow first response**: the model is loading into memory on the first call. Subsequent calls are faster while it stays resident.
- **Output cut off / truncated**: lower the "Maximum note length" if your model has a small output limit, or pick a model with a larger context. Some local models silently truncate rather than erroring.
- **Garbled or off-task output**: the model is too small for the template's structure. Step up a size, or simplify the template prompt.

See also the general [Troubleshooting](Troubleshooting) page and [Providers](Providers) for the base-URL conventions.

[Back to Home](Home)
