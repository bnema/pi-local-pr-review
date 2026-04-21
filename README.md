# pi-local-pr-review

`pi-local-pr-review` adds a browser-based local PR review flow to pi.

It starts a local HTTP server, opens a GitHub-style branch diff in the browser, lets you draft summary + inline comments, and sends the submitted review back into the active pi session.

## What it does

- starts a local review server bound to the current pi session
- shows the current branch diff against a base ref in a browser UI
- supports summary comments and inline file comments
- sends the submitted review back to the active session as a user message
- stops automatically after a successful submission

## Install

### Local development

```bash
pi install /absolute/path/to/pi-local-pr-review
```

Or for the current project only:

```bash
pi install -l /absolute/path/to/pi-local-pr-review
```

## Usage

### Slash commands

- `/review-start` — start review UI using the default base ref
- `/review-start <base-ref>` — start review UI against a specific base
- `/review-status` — show the running review URL for this session
- `/review-stop` — stop the running review server for this session

### Natural language

The extension also exposes a tool so pi can start, stop, or inspect the review UI when you ask in chat.

Examples:

- "Start the local PR review UI"
- "Open branch review against main"
- "Stop the review server"

## Notes

- The review server is session-bound.
- When a review is submitted while pi is busy, feedback is queued as a follow-up message.
- The initial browser UI/server implementation was adapted from the local branch review flow in Superpowers and retargeted for pi.
