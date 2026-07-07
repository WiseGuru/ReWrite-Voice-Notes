# Troubleshooting

Start here, then follow the link into the page with the detail for your problem.

## Setup and configuration

- **The modal blocks recording/pasting with a setup card.** The active profile is missing a provider, model, key, or (for `openai-compatible`) a base URL. Fill in the highlighted fields. See [Settings reference](Settings-Reference) and [Providers](Providers).
- **No templates in the dropdown.** You have not populated them yet. Settings, Templates, Populate. See [Quick start](Quick-Start).
- **The plugin asks for a passphrase / says it is locked.** You are in passphrase encryption mode and the key is not unlocked. Enter your passphrase. See [Secrets and sync](Secrets-and-Sync).
- **Keys disappeared after syncing to another device.** Encrypted keys do not decrypt cross-device in some modes; this is expected. Re-enter the key on that device, and consider excluding `secrets.json.nosync` from sync. See [Secrets and sync](Secrets-and-Sync).
- **A notice says the secrets file looked corrupted.** A crash or sync conflict damaged `secrets.json.nosync`. The plugin preserves the damaged file as `secrets.json.nosync.corrupt` and starts fresh rather than risk overwriting it. Re-enter your keys. See [Secrets and sync](Secrets-and-Sync#if-the-secrets-file-gets-corrupted).

## Provider errors

- **An error names the provider and an HTTP status.** That is the provider rejecting the request (bad key, wrong model id, rate limit, oversized audio). Read the message; it is attributed to the provider on purpose.
- **"Maximum note length" / max-tokens error.** Your output cap is above the model's limit. Lower it in the profile. See [Providers](Providers).
- **Recording too large.** You hit a provider's size or duration ceiling. Switch to a higher-ceiling provider (AssemblyAI, Rev.ai) or shorten the clip. Limits are listed in [Providers](Providers) and [Commands and menus](Commands-and-Menus).
- **The "ReWrite: ..." progress notice seems stuck.** Click **Cancel** on the notice to stop the run. Note that a request already in flight to a provider can't be interrupted mid-transfer (Obsidian's networking layer has no cancel signal), so Cancel takes effect at the next stage boundary rather than instantly.

## Recording

- **"No audio detected" warning.** The mic is muted, dead, or not granted permission for several seconds. Check your OS mic permissions and input device.
- **Recording stops when the screen sleeps (mobile).** A WebView limitation, mitigated by a wake lock. See [Mobile](Mobile).

## Self-hosted whisper.cpp

Port conflicts, antivirus, startup timeouts, the loopback refusal, and FUTO `-ac` issues are all covered on [Self-hosting: whisper.cpp](Self-Hosting-Whisper#troubleshooting).

## Self-hosted / local LLMs

Connection refused, 404 on the `/v1` path, model-not-found, LAN access, and truncated output are covered on [Self-hosting: local and remote LLMs](Self-Hosting-LLMs#troubleshooting).

## Still stuck?

Open an issue on the [repository](https://github.com/WiseGuru/ReWrite-Voice-Notes/issues) with the provider, the exact error text, and what you were doing. For self-hosted setups, include the relevant log tail.

[Back to Home](Home)
