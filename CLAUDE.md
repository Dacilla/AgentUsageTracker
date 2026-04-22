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

# Type-check both tsconfigs (no emit)
npm run typecheck
```

To run/debug the extension: press **F5** in VS Code (uses `.vscode/launch.json` → `extensionHost` launcher, which runs `npm run build` as a pre-launch task and loads the extension from `dist/`).

There are no automated tests in this project.

## Architecture

Two separate TypeScript compilation units with separate tsconfigs:

- **Extension host** (`tsconfig.json`): CJS, `ES2020`, no DOM lib. Entry: `src/extension.ts` → `dist/extension.js` (esbuild bundle, `vscode` is external).
- **Webview frontend** (`src/webview/frontend/tsconfig.json`): ESNext, DOM lib, JSX, bundler module resolution. Entry: `src/webview/frontend/main.tsx` → `dist/webview/` (Vite).

### Layers

**`src/extension.ts`** — thin orchestrator only. Wires store, collectors, UI, and commands. Contains no logic.

**State layer** (`src/state/`):
- `store.ts` — `Store` class: ring-buffer of up to 5,000 `UsageEvent`s, map of up to 100 `Session`s, listener pub/sub. Serializes to/deserializes from `context.globalState`. Events older than 7 days are pruned on `hydrate()`.
- `sessions.ts` — session lifecycle: `recordPrompt`, `resetSession`, `maybeExpireSession`, `computeContextScore`.
- `usage.ts` — derives rolling-window statistics (5h, 7d) from `store.getEventsInWindow()`.

**Collector layer** (`src/collectors/`):
- `claude.ts` / `codex.ts` — each implements `Collector { start, stop }`. Three detection tiers tried in order: (1) extension API exports, (2) `fs.watch` on JSONL session files (`~/.claude/projects/` for Claude), (3) heuristic `onDidChangeTextDocument` fallback. On Linux, `fs.watch({ recursive })` is unsupported so per-subdirectory watchers are used instead.
- `detector.ts` — calls `start` on both collectors; also sets up the 30-second `globalState` persistence interval.

**UI layer** (`src/ui/`):
- `statusBar.ts` — always-visible `$(robot) C:N X:N · 5h:N/N` item; updates synchronously (no debounce).
- `tree/summaryProvider.ts` / `tree/recentProvider.ts` — VS Code tree view providers; refresh debounced at 250 ms via `store.onDidChange`.

**Webview** (`src/webview/`):
- `panel.ts` — `DashboardPanel` (singleton); owns the `WebviewPanel`, subscribes to the store, posts `{ type: 'stateUpdate', payload: SerializedState }` to the webview (debounced 250 ms), and handles incoming messages (`resetSession`, `snoozeWarning`, `requestState`).
- `frontend/` — React + Vite app. `acquireVsCodeApi()` is called once at module scope in `App.tsx`, not inside components.

### Key data types (`src/types.ts`)

- `Agent = "claude" | "codex"`
- `UsageEvent { agent, timestamp, sessionId }`
- `Session { id, agent, startTime, lastActivity, promptCount, turns, filesTouched, largeInputs, retries, contextScore, contextState, workspace }`
- Context score formula: `clamp((turns*2) + (filesTouched*3) + (largeInputs*5) + (retries*4), 0, 100)`; thresholds: busy≥50, heavy≥70, bloated≥85.

### Persistence

`context.globalState` key `'agentTrackerState'` holds the serialized store. Written every 30 seconds and on workspace folder changes. On hydration, events >7 days old are dropped; sessions capped at 100 (oldest evicted).

### Webview asset paths

Vite is configured with no filename hashing so `panel.ts` can construct a predictable URI: `dist/webview/assets/index.js` and `dist/webview/assets/index.css`. The webview HTML is generated inline in `panel.ts` using `webview.asWebviewUri()`.
