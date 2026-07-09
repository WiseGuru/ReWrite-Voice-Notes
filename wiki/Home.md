# ReWrite (Voice Notes) wiki

ReWrite is an Obsidian plugin that captures speech (live recording or a pasted transcript), runs it through a transcription provider, cleans and structures it with an LLM, and inserts the result into your vault. You bring your own provider keys; nothing is sent to a ReWrite server. It can also run entirely on-device by pairing the plugin-managed whisper.cpp transcription with a local OpenAI-compatible LLM.

**New here? Start with the [Quick start](Quick-Start).** It walks you from install to your first note in a few minutes.

## Contents

### Getting started
- [Quick start](Quick-Start) - install, populate templates, and create your first note (Daily note example).

### Reference
- [Settings reference](Settings-Reference) - every setting in the plugin's settings tab, section by section.
- [Commands and menus](Commands-and-Menus) - the command palette, ribbon, editor and file menus, and Quick Record.
- [Creating templates](Creating-Templates) - the template file format and a full guide to writing your own.
- [Providers](Providers) - choosing and configuring transcription and LLM providers, models, diarization, context hints, and known nouns.
- [Voxtral real-time (disabled)](Voxtral-Realtime) - the reverse-engineered Voxtral streaming protocol, why its browser-auth caveat keeps it disabled, and how to help.

### Self-hosting
- [Self-hosting: whisper.cpp](Self-Hosting-Whisper) - on-device transcription with the plugin-managed local whisper.cpp server.
- [Self-hosting: local and remote LLMs](Self-Hosting-LLMs) - Ollama / llama.cpp locally or on a remote server, with model picks for low-spec hardware.

### Help
- [Secrets and sync](Secrets-and-Sync) - how API keys are encrypted, and how to exclude `secrets.json.nosync` from each sync tool.
- [Mobile](Mobile) - what behaves differently on iOS and Android.
- [Troubleshooting](Troubleshooting) - triage for the most common problems.

## How it works at a glance

1. **Capture**: record in Obsidian, paste a transcript, or pull text from a note. You can also reprocess an audio file already in your vault.
2. **Transcribe**: audio goes to your configured transcription provider (skipped for text input).
3. **Clean and structure**: the transcript is sent to your LLM with the selected template's prompt, the shared-core baseline, and any known nouns or spoken instructions.
4. **Insert**: the result lands at your cursor, appended to the current note, or in a new note, per the template. Recorded audio is saved and linked back with an `![[...]]` embed.

These docs are maintained in the [`wiki/` folder of the code repo](https://github.com/WiseGuru/ReWrite-Voice-Notes/tree/master/wiki) and mirrored here automatically. Edit them there, not in the wiki.
