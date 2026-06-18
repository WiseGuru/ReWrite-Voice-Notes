# Quick start

This page takes you from a fresh install to your first cleaned-up note. It uses the **Daily note** template as the worked example, but the same flow applies to every template.

For deeper detail on any step, see [Settings reference](Settings-Reference), [Providers](Providers), and [Creating templates](Creating-Templates).

## 1. Install the plugin

### Community plugins (recommended)

1. In Obsidian, open Settings, Community plugins, and turn off Restricted mode if it is on.
2. Click Browse, search for "ReWrite (Voice Notes)", and click Install, then Enable.

### Manual install (latest release)

If the plugin is not yet listed, or you want a specific build:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest entry on the [Releases page](https://github.com/WiseGuru/ReWrite-Voice-Notes/releases).
2. Create the folder `<YourVault>/.obsidian/plugins/rewrite-voice-notes/`.
3. Copy the three files into that folder.
4. In Obsidian, open Settings, Community plugins, and enable "ReWrite (Voice Notes)" (Restricted mode off).

## 2. Configure a provider

Open Settings, ReWrite (Voice Notes). The plugin has two profiles (one for desktop, one for mobile) so you can use different providers on each device. Configure the profile marked active on this device:

- **Transcription provider** (turns audio into text): pick a provider, enter its API key, and choose a model. Skip this if you only ever paste or process existing text.
- **LLM provider** (cleans and structures the text): pick a provider, enter its API key, and choose a model.

You bring your own keys; nothing is sent to a ReWrite server. The first time you save a key, the plugin sets up encryption at rest (your OS secret store, or a passphrase you choose). See [Providers](Providers) for the full provider list and [Secrets and sync](Secrets-and-Sync) for how keys are stored.

Want zero cloud dependency? See [Self-hosting: whisper.cpp](Self-Hosting-Whisper) and [Self-hosting: local and remote LLMs](Self-Hosting-LLMs).

## 3. Install the templates

ReWrite keeps its templates as Markdown files in your vault, not buried in settings. They do not exist until you create them:

1. In Settings, scroll to the **Templates** section.
2. Click **Populate**.

This creates, under `ReWrite/` in your vault:

- `ReWrite/Templates/` with 10 starter templates (General cleanup, Todo list, Daily note, Meeting notes, Meeting transcript, Idea capture, Lecture, Podcast, Guides, Book log).
- `ReWrite/SharedCore.md`, the cleanup ground rules prepended to every template.
- `ReWrite/AssistantPrompt.md` and `ReWrite/KnownNouns.md`, optional helpers.
- `ReWrite/Template guide.md`, a human-facing explanation of the format (never sent to an LLM).

Populate is non-destructive: re-running it only adds what is missing, so your edits are safe. To pull in changed defaults later, use **Update** instead (see [Creating templates](Creating-Templates)).

## 4. Create your first note (Daily note)

The **Daily note** template writes a new, date-named note: it pulls out Calendar, Goals, and Tasks sections when you mention them, then drops the full cleaned transcript into a Braindump section.

1. Click the **mic ribbon icon** (or run the **Open** command from the command palette).
2. In the template dropdown at the top, choose **Daily note**.
3. Either:
   - **Record**: click Record, speak (for example: "Today I have a dentist appointment at 2pm. My goal is to finish the quarterly report. I need to email Sarah and buy groceries. Also I keep thinking about that side project idea..."), then Stop. The original audio is saved to your attachments folder and linked into the note.
   - **Paste**: switch to the Paste tab and paste an existing transcript instead. No transcription provider needed for this path.
4. The plugin transcribes (if recording), cleans the text with your LLM, and creates a new dated note with the structured result.

That's the whole loop: capture, clean, insert. Swap the template to change the shape of the output.

## 5. Where to go next

- **Faster capture**: [Quick Record](Commands-and-Menus) records with no modal, using your last or a pinned template. Press the hotkey once to start, again to stop.
- **Process existing text or audio**: run a template over a selection, or reprocess an audio file already in your vault. See [Commands and menus](Commands-and-Menus).
- **Make it yours**: edit the bundled templates or write new ones in [Creating templates](Creating-Templates).
- **Run it locally**: [whisper.cpp](Self-Hosting-Whisper) for on-device transcription, [local LLMs](Self-Hosting-LLMs) for on-device cleanup.

[Back to Home](Home)
