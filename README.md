# Agent Usage Tracker

A VS Code extension that tracks your Claude Code and OpenAI Codex usage in real time — rolling windows, session tracking, and context-bloat detection.

## Features

- **Rolling usage windows** — 5-hour and 7-day prompt counts per agent with configurable limits
- **Session tracking** — automatically splits sessions on inactivity; tracks turns, files touched, retries
- **Context-bloat detection** — scores active sessions (healthy / busy / heavy / bloated) so you know when to start fresh
- **Status bar** — always-visible `$(robot) C:12 X:3 · 5h:15/40` summary; turns warning/error color as limits approach
- **Sidebar views** — Summary (window totals + active sessions) and Recent & Alerts tree views
- **Dashboard** — full webview panel with agent cards, usage bars, context meters, and session inspector

## Requirements

- VS Code 1.90+
- Claude Code (`Anthropic.claude-code`) and/or OpenAI Codex VS Code extensions installed

## Detection

The extension uses three tiers per agent, in priority order:

1. **Extension API** — subscribes to the agent extension's event emitter if one is exposed
2. **JSONL file watching** — tails `~/.claude/projects/**/*.jsonl` (Claude) and equivalent Codex paths; counts lines where `role === "user"`
3. **Heuristic fallback** — infers a prompt when >10 lines are inserted in a single document edit (debounced to 10s)

All tier activations are logged to the **Agent Tracker** output channel.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `agentTracker.max5h` | `40` | Prompt limit for the rolling 5-hour window |
| `agentTracker.max7d` | `200` | Prompt limit for the rolling 7-day window |
| `agentTracker.contextThresholds.busy` | `50` | Context score for "busy" state |
| `agentTracker.contextThresholds.heavy` | `70` | Context score for "heavy" state |
| `agentTracker.contextThresholds.bloated` | `85` | Context score for "bloated" state |
| `agentTracker.inactivityTimeoutMinutes` | `30` | Minutes before a new session is started |

## Commands

| Command | Description |
|---|---|
| `Agent Tracker: Open Dashboard` | Open the full webview dashboard |
| `Agent Tracker: New Session` | Force-start a new Claude session |
| `Agent Tracker: Reset Current Session` | Close and reset the active session |
| `Agent Tracker: Snooze Context Warning` | Dismiss the current context warning |
| `Agent Tracker: Record Prompt (Manual)` | Manually record a prompt (useful when auto-detection misses) |

## Development

```bash
npm install
npm run build        # build extension host + webview
npm run typecheck    # type-check both tsconfigs
```

Press **F5** in VS Code to launch the extension in a new Extension Development Host window.

For active development, run the watch modes in two terminals:

```bash
npm run watch:ext      # esbuild watching src/extension.ts
npm run watch:webview  # Vite watching src/webview/frontend/
```

## Notes

This is a personal observability tool. Detection accuracy is best-effort — use `Agent Tracker: Record Prompt (Manual)` as a fallback when auto-detection misses a prompt.
