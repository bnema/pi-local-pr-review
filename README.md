# pi-local-pr-review

`pi-local-pr-review` is the pi-specific adapter for the shared `local-pr-review-server`.

It launches the shared `local-pr-review-server`, opens a GitHub-style branch diff in the browser, lets you draft summary + inline comments, and sends the submitted review back into the active pi session.

## What it does

- acts as the pi integration layer around the shared review server
- starts a local review server bound to the current pi session
- shows the current branch diff against a base ref in a browser UI
- supports summary comments and inline file comments
- sends the submitted review back to the active session as a user message
- stops automatically after a successful submission

## Install

### From GitHub

Install globally:

```bash
pi install git:github.com/bnema/pi-local-pr-review
```

Install for the current project only:

```bash
pi install -l git:github.com/bnema/pi-local-pr-review
```

Pi clones the adapter and runs `npm install`, which pulls the shared `local-pr-review-server` dependency automatically.

### Local development

For local hacking, keep the repos side by side:

- `../pi-local-pr-review`
- `../local-pr-review-server`

Then install this package into pi from disk:

```bash
pi install /absolute/path/to/pi-local-pr-review
```

Or for the current project only:

```bash
pi install -l /absolute/path/to/pi-local-pr-review
```

## Usage

After installation, ask pi to open the review UI or use one of the commands below.

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
