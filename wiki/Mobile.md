# Mobile

Obsidian on iOS and Android runs in a constrained WebView, so a few things behave differently from desktop.

## Screen-off during recording

Mobile WebViews suspend (and stop `MediaRecorder` capture) when the screen sleeps. To counter this, the plugin holds a screen wake lock for the duration of an active recording on both iOS and Android, so screen-off mid-recording is largely mitigated on supported OS versions. It is best-effort: on older WebViews, in an insecure context, or if the OS denies the request, it silently falls back, so keeping the screen on (or using the Paste tab with an OS-level dictation keyboard) is still the safe habit. The trade-off is that the screen stays lit while recording.

## Encryption on mobile

If your Obsidian version provides secret storage on mobile, keys use it just like on desktop. Otherwise the plugin prompts you to set a passphrase before any key can be saved, and keys are then encrypted with Argon2id/PBKDF2 AES-GCM. The `secrets.json.nosync` file (which holds encrypted keys only in passphrase mode) uses the `.nosync` suffix so iCloud Drive skips it; for other sync tools, see [Secrets and sync](Secrets-and-Sync).

## Recording size limits

Each transcription provider enforces its own ceiling. OpenAI Whisper and Groq are the tightest at 25 MB; AssemblyAI, Deepgram, and Rev.ai allow gigabytes. These are provider-API limits, not Obsidian ones, and are most likely to bite on long mobile recordings with the 25 MB providers. See per-provider limits in [Providers](Providers).

## Local whisper.cpp is desktop only

The plugin-managed local whisper.cpp server spawns a native child process and is unavailable on mobile. The option is hidden from the mobile profile's provider dropdown. Use a cloud transcription provider, or a remote OpenAI-compatible transcription server, on mobile.

## Keyboard and layout

The plugin pins its popups to the top of the screen on mobile so they stay visible above the soft keyboard, and trims a few input sizes (for example the Paste box renders shorter) so submit buttons stay reachable. No configuration needed.

## Profiles

The plugin ships separate Desktop and Mobile profiles so you can, for example, use a local stack on desktop and cloud providers on your phone. Each device auto-detects its profile; you can override which is active in Settings, Active profile. See [Settings reference](Settings-Reference).

[Back to Home](Home)
