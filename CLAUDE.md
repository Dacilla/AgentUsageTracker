# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Full build (extension host + webview)
npm run build

# Build only extension host (esbuild → dist/extension.js)
npm run build:ext

# Build only webview (Vite → dist/webview/)
npm run build:webview

# Watch modes (run in separate terminals)
npm run watch:ext
npm run watch:webview

# Run parser/state/watcher tests
npm run test

# Type-check both tsconfigs (no emit)
npm run typecheck
```

To run/debug the extension: press **F5** in VS Code (uses `.vscode/launch.json` → `extensionHost` launcher, which runs `npm run build` as a pre-launch task and loads the extension from `dist/`).

Generated test output is written to `.test-dist/` via `tsconfig.test.json` and should not be tracked in git.

## Testing

The project has a lightweight Node-based test harness instead of a full test framework setup.

- `tests/parsers.test.ts` — validates Claude/Codex JSONL prompt parsing
- `tests/jsonlWatch.test.ts` — validates incremental JSONL watching, including partial-line buffering
- `tests/sessions.test.ts` — validates session lifecycle and retry/context scoring
- `tests/store.test.ts` — validates store notifications, serialization, and snoozed-warning persistence

## Architecture

Two separate TypeScript compilation units with separate tsconfigs:

- **Extension host** (`tsconfig.json`): CJS, `ES2020`, no DOM lib. Entry: `src/extension.ts` → `dist/extension.js` (esbuild bundle, `vscode` is external).
- **Webview frontend** (`src/webview/frontend/tsconfig.json`): ESNext, DOM lib, JSX, bundler module resolution. Entry: `src/webview/frontend/main.tsx` → `dist/webview/` (Vite).
- **Test compilation** (`tsconfig.test.json`): CommonJS output into `.test-dist/` for Node's built-in test runner.

### Layers

**`src/extension.ts`** — extension entry point. Wires store, collectors, UI, commands, file-touch tracking, and agent-selection prompts for commands that operate on sessions.

**State layer** (`src/state/`):
- `store.ts` — `Store` class: ring-buffer of up to 5,000 `UsageEvent`s, map of up to 100 `Session`s, active-session tracking, snoozed-session tracking, listener pub/sub, and `context.globalState` serialization. Events older than 7 days are pruned on `hydrate()`.
- `sessions.ts` — session lifecycle: `recordPrompt`, `resetSession`, `startFreshSession`, `maybeExpireSession`, `incrementFilesTouched`, `computeContextScore`.
- `usage.ts` — derives rolling-window statistics (5h, 7d) from `store.getEventsInWindow()`.

**Collector layer** (`src/collectors/`):
- `claude.ts` / `codex.ts` — each implements `Collector { start, stop }`. Three detection tiers tried in order: (1) extension API exports, (2) incremental JSONL file watching, (3) heuristic `onDidChangeTextDocument` fallback.
- `jsonlWatch.ts` — shared incremental JSONL watcher that tracks file offsets, buffers partial lines, and only parses appended content.
- `parsers.ts` — agent-specific JSONL parsing. Codex prompt detection currently recognizes `event_msg` records with `payload.type === "user_message"` in addition to simpler `role/type === "user"` shapes.
- `detector.ts` — calls `start` on both collectors; also sets up the 30-second `globalState` persistence interval.

**UI layer** (`src/ui/`):
- `statusBar.ts` — always-visible `$(robot) C:N X:N · 5h:N/N` item; updates synchronously and ignores snoozed heavy/bloated session warnings while still showing rolling-window pressure.
- `tree/summaryProvider.ts` / `tree/recentProvider.ts` — VS Code tree view providers; refresh debounced at 250 ms via `store.onDidChange`.

**Webview** (`src/webview/`):
- `panel.ts` — `DashboardPanel` (singleton); owns the `WebviewPanel`, subscribes to the store, posts `{ type: 'stateUpdate', payload: SerializedState }` to the webview (debounced 250 ms), and handles incoming messages (`resetSession`, `snoozeWarning`, `requestState`).
- `frontend/` — React + Vite app. `acquireVsCodeApi()` is called once at module scope in `App.tsx`, not inside components. The dashboard now includes a session selector and session inspector in addition to the top-level usage cards.

### Key data types (`src/types.ts`)

- `Agent = "claude" | "codex"`
- `UsageEvent { agent, timestamp, sessionId }`
- `Session { id, agent, startTime, lastActivity, promptCount, turns, filesTouched, largeInputs, retries, contextScore, contextState, workspace }`
- `SerializedState` now also includes `snoozedSessionIds`
- Context score formula: `clamp((turns*2) + (filesTouched*3) + (largeInputs*5) + (retries*4), 0, 100)`; thresholds: busy≥50, heavy≥70, bloated≥85.

### Persistence

`context.globalState` key `'agentTrackerState'` holds the serialized store. Written every 30 seconds and on workspace folder changes. On hydration, events >7 days old are dropped; sessions capped at 100 (oldest evicted). Snoozed session IDs are persisted alongside the rest of the store state.

### Webview asset paths

Vite is configured with no filename hashing so `panel.ts` can construct a predictable URI: `dist/webview/assets/index.js` and `dist/webview/assets/index.css`. The webview HTML is generated inline in `panel.ts` using `webview.asWebviewUri()`.
