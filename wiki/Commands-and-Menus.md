# Commands and menus

Every entry point ReWrite adds: command palette commands, the ribbon icon, right-click menus, and the Quick Record floating UI. Bind hotkeys to any command in Obsidian's Hotkeys settings.

## Command palette

| Command | What it does |
| --- | --- |
| **Open** | Opens the main modal with your last-used template selected. Same as the ribbon mic icon. |
| **Quick record (last used)** | Starts recording immediately with a floating mini-UI, using the last-used template. Press again (or its hotkey) to stop. |
| **Quick record (set template)** | Same one-shot capture, but always uses the template pinned in Settings, Templates, Quick record (set template). If none is pinned, it shows a notice and does nothing. |
| **Process text with template** | Runs a template over the current editor selection, or the whole note if nothing is selected. No audio. Progress shows via notices. |
| **Reprocess audio file with template** | Reruns the full pipeline over an audio file already in your vault. Opens an audio-file picker, then a template picker. |
| **Start whisper host** / **Stop whisper host** | Starts or stops the local whisper.cpp server. Only visible on desktop when relevant (start: active profile uses `whisper-local`; stop: the host is running or starting). See [Self-hosting: whisper.cpp](Self-Hosting-Whisper). |

## Ribbon and status bar

- **Mic ribbon icon**: opens the main modal (same as the Open command).
- **Whisper status bar item** (desktop only): shows the local whisper.cpp server's live state when the active profile uses it. Click it to start or stop the server.

## Right-click menus

- **Editor menu** ("ReWrite with template..."): right-click in a note to run a template over the selection or whole note, the same as the Process text command.
- **Editor menu** ("Reprocess audio with template..."): appears only when your cursor sits inside an `![[audio]]` embed; reprocesses that linked audio file.
- **File explorer menu** ("Reprocess audio with template..."): right-click an audio file in the file explorer to reprocess it.

## The main modal

Opened by the ribbon icon or the Open command. It has:

- A **template selector** at the top.
- Three input tabs: **Record** (capture in Obsidian), **Paste** (paste an existing transcript), and **From note** (pull the active note's selection or whole body).
- A collapsible **Destination** control to override, for this run only, where the output goes (cursor / new file / append) without editing the template on disk.
- A collapsible **Context** field, shown only for templates that enable it, for one-off background info (speakers, subject, setting). See [Providers](Providers).
- An inline **setup card** that blocks recording or pasting until the active profile is configured, with a shortcut to fix it.

## Quick Record floating UI

Quick Record skips the modal entirely. When you start it, a small floating panel appears with:

- A **live timer**.
- A **template button** that opens a popover to switch templates for this recording (dismisses on selection, Escape, or outside click).
- A **Stop** button, preceded by a **stop-hotkey hint** ("Press <combo> or click Stop") when the command is bound to a hotkey.
- A **"No audio detected" warning** if the mic stays silent for a few seconds (a muted or dead mic).

Both Quick Record commands share one in-flight recording, so either one stops a recording the other started. If the active profile is not configured, or audio capture is unavailable, Quick Record opens the main modal instead. If the pipeline errors after capture, the modal opens so you can retry; the saved audio file is your recovery path.

## Long-form audio

Lectures, meetings, interviews, and podcasts use the same pipeline. Drop the file anywhere in your vault and **Reprocess** it with the **Lecture** or **Podcast** template. For multi-hour recordings, choose a provider with a high ceiling such as AssemblyAI or Rev.ai (OpenAI Whisper and Groq cap at 25 MB; Mistral Voxtral at 30 minutes), and turn on **Identify speakers** to keep speaker labels through cleanup. See per-provider limits in [Providers](Providers). Only process audio you have the right to use.

[Back to Home](Home)
