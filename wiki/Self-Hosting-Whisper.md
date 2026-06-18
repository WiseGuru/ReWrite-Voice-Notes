# Self-hosting: whisper.cpp

For fully on-device transcription with no network calls, ReWrite can spawn a [whisper.cpp](https://github.com/ggerganov/whisper.cpp) `whisper-server` binary that you supply. The plugin only reads the absolute paths you configure; it never downloads binaries, never looks them up on PATH, and never spawns anything you did not explicitly point it at. **Desktop only.**

Pair this with a [local LLM](Self-Hosting-LLMs) for a setup where neither audio nor text leaves your machine.

## How it works and the security model

When you click Start in settings, the plugin launches whisper-server as a child process and talks to it over loopback (`http://127.0.0.1:<port>/inference`). Its stdout/stderr are captured in a ring-buffered log you can view in settings. When you click Stop, or when the plugin unloads, the process is terminated. The plugin records a small PID sidecar file so that if Obsidian restarts while the server is still running, it can re-adopt that exact process instead of orphaning or double-spawning it. It will never kill a process it did not start.

**Loopback only.** whisper-server has no authentication and no TLS, so anyone who can reach its port can submit audio and exercise its native audio-decoding code. ReWrite always passes `--host 127.0.0.1` when you do not specify a host, and **refuses to start** if you put a non-loopback `--host` (such as `0.0.0.0` or a LAN IP) in Extra args. The exact refusal is:

> Refusing to start: --host <value> would bind whisper-server to a non-loopback interface, exposing an unauthenticated transcription server to your network. Remove it from Extra args; ReWrite always binds 127.0.0.1.

Loopback values it accepts: `127.0.0.1`, `localhost`, `::1`, `[::1]`. If you run whisper-server yourself from a terminal, bind it to `127.0.0.1` the same way; do not expose it to your network unless you have put your own authenticating proxy in front of it.

## Setup

### 1. Get a `whisper-server` binary

- **Windows**: download the latest `whisper-bin-x64.zip` (CPU) or `whisper-cublas-*.zip` (NVIDIA GPU) from the [whisper.cpp releases page](https://github.com/ggerganov/whisper.cpp/releases), unzip somewhere stable (for example `C:\Tools\whisper.cpp\`), and use the path to `whisper-server.exe`.
- **macOS**: `brew install whisper-cpp` installs a `whisper-server` binary; `which whisper-server` shows its absolute path. Or build from source as on Linux.
- **Linux**: there are no official Linux binaries, so build from source once (see below).

### 2. Download a GGML model

- **Upstream GGML models** from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp/tree/main), for example `ggml-base.en.bin`, `ggml-small.bin`, `ggml-large-v3.bin`. Larger is more accurate and slower.
- **FUTO whisper-acft models** (see below): quantized, finetuned variants that support a dynamic audio context for lower latency. They load with the same `-m` flag.

### 3. Configure the plugin

In ReWrite settings, scroll to **Local whisper.cpp server (desktop)** and fill in:

- **Binary path**: absolute path to `whisper-server` (or `whisper-server.exe`). The **Auto-detect** button checks common install locations (`~/.local/bin`, `~/.local/share/whisper.cpp/build/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`) and fills the field if it finds one.
- **Model path**: absolute path to the `.bin` model file.
- **Port**: defaults to 8080.
- **Extra args** (optional): space-separated CLI args appended after `-m` and `--port`. Split on whitespace only (a single value containing spaces, such as a quoted path, is not supported). Do not add a non-loopback `--host` here.

### 4. Start it

Click **Start**. The status indicator moves Stopped, Starting, Running. **View log** shows whisper-server's output if startup fails. You can also start/stop from the command palette and the desktop status-bar item.

### 5. Use it from a profile

Set the profile's **Transcription provider** to "Local whisper.cpp (desktop only)". The Transcription model field is decorative for this provider; whisper-server uses whichever model file is loaded at startup. No API key is needed. The plugin transcodes recordings to 16 kHz mono WAV before sending them to `/inference`.

## Building whisper-server on Linux

whisper.cpp does not publish prebuilt Linux binaries, so compile it once. There is a helper script in the repo at `scripts/build-whisper-linux.sh`, or do it by hand:

1. Install the toolchain for your distro:
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
   The default build includes the `server` example. For CUDA, add `-DGGML_CUDA=ON` to the first `cmake` line (requires the CUDA toolkit; longer build).
3. The binary lands at `<clone>/build/bin/whisper-server`. Copy or symlink it somewhere stable (for example `~/.local/bin/whisper-server`) and ensure it is executable (`chmod +x`).
4. Sanity-check it once from a terminal: `./build/bin/whisper-server -m /path/to/model.bin --host 127.0.0.1 --port 8080`. You should see `whisper server listening at http://127.0.0.1:8080`. Ctrl-C to stop, then let the plugin manage it.

If `cmake --build` fails with `'std::filesystem' has not been declared` or similar C++17 errors, your GCC is too old. Install a newer one (`sudo apt install g++-12`) and rerun the `cmake -B build ...` step with `-DCMAKE_CXX_COMPILER=g++-12`.

## FUTO whisper-acft models (faster short clips)

[whisper-acft](https://github.com/futo-org/whisper-acft) is a set of Whisper checkpoints finetuned by FUTO so whisper.cpp's encoder tolerates a dynamic `audio_ctx` (the number of audio frames it processes). Lowering the audio context on a stock model makes it unstable; the ACFT models were retrained to handle it, cutting latency on short utterances (often a 2x to 4x speedup on small models).

The checkpoints are quantized to `q8_0` in the same GGML container the `-m` flag accepts, so no special build is needed, only a whisper.cpp recent enough to recognize the `-ac` / `--audio-context` flag.

1. Download a `.bin` (English-only is smaller and faster for English; multilingual handles other languages):
   - English-only: `tiny_en_acft_q8_0.bin`, `base_en_acft_q8_0.bin`, `small_en_acft_q8_0.bin`
   - Multilingual: `tiny_acft_q8_0.bin`, `base_acft_q8_0.bin`, `small_acft_q8_0.bin`

   These are published under `https://voiceinput.futo.org/VoiceInput/`. Verify the download finished cleanly; a truncated `.bin` fails to load with a cryptic log error.
2. Set **Model path** to the FUTO `.bin`. Binary path and Port are unchanged.
3. Set **Extra args** to `-ac 768` (a sensible default for short to medium clips). `-ac` caps the encoder context: lower runs faster but only stays accurate on ACFT models.
   - `-ac 512` for very short memos (under ~10 s).
   - `-ac 1500` disables the speedup (the default for 30 s of audio); use it if you dictate longer than ~20 s and the tail gets cut.
   - Combine flags on one line, for example `-ac 768 -t 4` to also cap CPU threads.
4. Click Start (or Restart). The log should show the ACFT model loading. The transcription provider needs no changes.

If transcripts get truncated or jumbled, `-ac` is too low for your clip length; raise it toward 1500 until stable.

## Troubleshooting

- **Port already in use**: another process is bound to the port. Change the port or stop the other process. The plugin will not kill processes it did not start.
- **"Port N is bound by an external whisper-server"**: a whisper-server the plugin did not start holds the port. Stop it via your OS tools first.
- **"This whisper-server was not started by ReWrite"**: you tried to Stop an externally-started server. Stop it from your task manager.
- **Antivirus quarantine on Windows**: Defender or third-party AV may flag `whisper-server.exe` on first run. Whitelist the binary; the plugin cannot work around AV.
- **Permission denied (macOS / Linux)**: make the binary executable (`chmod +x whisper-server`).
- **"did not become ready within 5s"**: the model failed to load (wrong path, corrupted file, RAM exhausted). The log tail shows whisper.cpp's error.
- **`unknown argument: -ac`**: your whisper-server predates the dynamic audio-context flag. Update whisper.cpp, or remove `-ac` (FUTO models still load, you just lose the speedup).
- **FUTO model loads but transcripts are truncated**: `-ac` is too low for your audio length; raise it (`768` to `1024` to `1500`).

See also the general [Troubleshooting](Troubleshooting) page.

[Back to Home](Home)
