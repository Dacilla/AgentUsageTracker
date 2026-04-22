# AI Usage Tracker — Design Doc & Implementation Spec (v2)

## 1. Overview

### Goal
Build a VS Code extension that provides a clean, real-time dashboard of AI agent usage (Claude Code + OpenAI Codex), including:
* Rolling 5-hour window
* Rolling weekly window
* Per-agent breakdown
* Session tracking
* Context-bloat detection
* Fast, glanceable UI + deeper inspection

### Agents
Both agents are used as **VS Code extensions**, not CLI tools:
* **Claude Code** — Anthropic's VS Code extension (`Anthropic.claude-code`)
* **OpenAI Codex** — OpenAI's VS Code extension (exact marketplace ID probed at runtime)

### Non-goals
* Perfect token-level accounting
* Marketplace-grade compatibility
* Supporting terminal-based usage
* Supporting all agents

*This is a personal observability tool, not a billing-grade tracker.*

---

## 2. Core Concepts

### 2.1 Agents
```typescript
type Agent = "claude" | "codex";
```

### 2.2 Sessions
A "session" = continuous interaction with an agent in a thread.

```typescript
interface Session {
  id: string;
  agent: Agent;

  startTime: number;       // Unix ms
  lastActivity: number;    // Unix ms

  promptCount: number;

  // Heuristic signals
  turns: number;
  filesTouched: number;
  largeInputs: number;
  retries: number;

  contextScore: number;    // 0–100
  contextState: "healthy" | "busy" | "heavy" | "bloated";

  workspace: string;
}
```

### 2.3 Usage Windows
```typescript
interface UsageWindow {
  window: "5h" | "7d";
  events: UsageEvent[];
}

interface UsageEvent {
  agent: Agent;
  timestamp: number;   // Unix ms
  sessionId: string;
}
```

**Derived metrics:**
* Count per agent
* Total count
* Percentage of limit consumed

### 2.4 Global State
```typescript
interface GlobalState {
  sessions: Session[];
  events: UsageEvent[];   // ring buffer, max 5,000 entries

  activeSessionIds: Record<Agent, string | undefined>;
  settings: Settings;
}
```

### 2.5 Settings
```typescript
interface Settings {
  max5h: number;        // default: 40
  max7d: number;        // default: 200

  contextThresholds: {
    busy: number;       // default: 50
    heavy: number;      // default: 70
    bloated: number;    // default: 85
  };

  inactivityTimeoutMinutes: number;  // session split threshold
}
```

---

## 3. Architecture

```
Extension Host (Node.js)
│
├── Collector Layer     claude.ts, codex.ts, detector.ts
│     ├── Tier 1: vscode.extensions.getExtension().exports
│     ├── Tier 2: fs.watch on ~/.claude/projects/ and ~/.codex/
│     └── Tier 3: onDidChangeTextDocument heuristic
├── State Layer
│     ├── store.ts       (ring-buffer events + sessions + listeners)
│     ├── sessions.ts    (lifecycle + context scoring)
│     └── usage.ts       (derived window statistics)
├── UI Layer
│   ├── statusBar.ts
│   ├── tree/summaryProvider.ts
│   ├── tree/recentProvider.ts
│   └── webview/panel.ts ↔ postMessage ↔ React app
│
└── extension.ts         (thin orchestrator, no logic)

Webview (sandboxed iframe — Vite + React)
└── src/webview/frontend/
    App.tsx → components/ → postMessage → panel.ts
```

---

## 4. Event Collection

### 4.1 Detection Strategy — Three Tiers (in priority order)

Both agents are detected using the same three-tier approach. The first successful tier wins; all tiers log their activation to the `Agent Tracker` output channel.

**Tier 1 — Extension API**
* `vscode.extensions.getExtension(extensionId).exports`
* If the extension exposes an event emitter or observable for prompt events, subscribe directly
* Most accurate, zero false positives

**Tier 2 — JSONL File Watching (primary in practice)**
* Both VS Code extensions wrap underlying engines that write append-only JSONL session files to disk
* Claude: `~/.claude/projects/<workspace-hash>/*.jsonl`
* Codex: candidate paths probed at startup — `~/.codex/`, `~/.openai/codex/`, platform-specific directories
* On each file `change` event: read only the last line (seek to `fileSize - 512`, find last `\n`, parse JSON)
* Count line as a prompt if `role === "user"` (or equivalent signal in the file format)
* **Linux caveat**: `fs.watch({ recursive: true })` is not supported on Linux — detect `process.platform === 'linux'` and attach individual watchers per subdirectory

**Tier 3 — Heuristic Fallback**
* `vscode.workspace.onDidChangeTextDocument`: if >10 lines are inserted in a single edit, treat it as probable agent output
* Debounced: minimum 10s between heuristic-triggered events to avoid overcounting
* Last resort only — intentionally conservative

### 4.2 Session Lifecycle
* **Start:** First prompt OR first prompt after inactivity gap > `inactivityTimeoutMinutes`
* **Continue:** Each prompt within the timeout window updates `lastActivity`
* **Expire:** Next `recordPrompt` call checks `maybeExpireSession` first — if elapsed > timeout, previous session is closed and a new one starts
* **Manual reset:** `agentTracker.resetSession` command closes the active session immediately

### 4.3 `recordPrompt` Flow
```
Tier fires
→ maybeExpireSession()   (start new session if timed out)
→ startSession() if no active session
→ recordPrompt()
  → increment turns
  → update lastActivity
  → computeContextScore()
  → store.addEvent()
  → store listeners fire
→ statusBar updates
→ tree views refresh (debounced 250ms)
→ webview postMessage (debounced 250ms)
```

---

## 5. Context Bloat Algorithm

### 5.1 Score (0–100)
```
score = clamp(
  (turns * 2) +
  (filesTouched * 3) +
  (largeInputs * 5) +
  (retries * 4),
  0, 100
)
```

> **Note:** The `sessionAgeMinutes` term from the original design is intentionally omitted. Age alone is not a reliable signal — a long idle session should not inflate the score.

### 5.2 State Mapping
```
score < 50  → "healthy"
score < 70  → "busy"
score < 85  → "heavy"
score ≥ 85  → "bloated"
```

### 5.3 Signal Increment Rules
* `turns` → every `recordPrompt()` call
* `retries` → if two prompt events arrive within 30s of each other
* `filesTouched` → when a new file is opened in the editor during an active session
* `largeInputs` → manual toggle via Command Palette, or detected when file context is large

---

## 6. UI Specification

### 6.1 Status Bar
```typescript
vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
```

**Format:** `$(robot) C:12 X:3 · 5h:15/40`

**Tooltip:** 7d totals per agent + active session context states

**Color:**
* `statusBarItem.warningBackground` when any agent exceeds 80% of its window limit
* `statusBarItem.errorBackground` when any agent exceeds 95%

**Click:** Opens dashboard (`agentTracker.openDashboard`)

### 6.2 Sidebar Views

```json
"viewsContainers": {
  "activitybar": [{ "id": "agentTracker", "title": "AI Usage", "icon": "media/icon.svg" }]
},
"views": {
  "agentTracker": [
    { "id": "agentTracker.summary", "name": "Summary" },
    { "id": "agentTracker.recent", "name": "Recent & Alerts" }
  ]
}
```

**Summary view:**
```
5-Hour Window
  Claude: 12 / 40
  Codex:  3 / 40
7-Day Window
  Claude: 89 / 200
  Codex:  31 / 200
Active Sessions
  claude — busy (score: 46)
  codex  — healthy (score: 12)
```

**Recent & Alerts view:**
```
Alerts
  ⚠ Claude session heavy
  ⚠ Weekly usage 82%

Recent
  Claude — repo-a  (2 min ago)
  Codex  — repo-b  (14 min ago)
  Claude — repo-c  (1 hr ago)
```

Tree views fire `onDidChangeTreeData` debounced at **250ms** on every store mutation.

### 6.3 Dashboard Webview

**Tech stack:**
* React + Vite (ES module bundle, no filename hashing)
* Plain CSS with VS Code theme variables:
  * `color: var(--vscode-editor-foreground)`
  * `background: var(--vscode-editor-background)`
  * `border-color: var(--vscode-panel-border)`
* No external CSS library

**Layout:**
* **Header:** Title, Agent filter (All / Claude / Codex), Window toggle (5h / 7d)
* **Row 1 — Hero Cards:** 5h usage, 7d usage, context health summary
* **Row 2 — Agent Cards:** Claude + Codex side-by-side
* **Row 3 — Activity:** Recent events list
* **Row 4 — Session Inspector:** Selected session details + Reset / Snooze buttons

**Message protocol:**

Host → Webview:
```typescript
{ type: 'stateUpdate', payload: SerializedState }
```

Webview → Host:
```typescript
{ type: 'resetSession', agent: Agent }
{ type: 'snoozeWarning', sessionId: string }
{ type: 'requestState' }
```

**`acquireVsCodeApi()`** must be called exactly once, at module scope in `App.tsx`, not inside a component or render function.

---

## 7. Commands

```json
"commands": [
  { "command": "agentTracker.openDashboard",  "title": "Agent Tracker: Open Dashboard" },
  { "command": "agentTracker.newSession",     "title": "Agent Tracker: New Session" },
  { "command": "agentTracker.resetSession",   "title": "Agent Tracker: Reset Current Session" },
  { "command": "agentTracker.snoozeWarning",  "title": "Agent Tracker: Snooze Context Warning" },
  { "command": "agentTracker.recordPrompt",   "title": "Agent Tracker: Record Prompt (Manual)" }
]
```

`agentTracker.recordPrompt` accepts an optional `agent` argument (defaults to `"claude"`) so users can bind it to a keybinding as a fallback when auto-detection misses.

---

## 8. Persistence

```typescript
// Write
context.globalState.update('agentTrackerState', store.serialize());

// Read
store.hydrate(context.globalState.get('agentTrackerState', ''));
```

**Persisted data:** events ring buffer (max 5,000), sessions list (max 100), settings.

**Pruning rules:**
* Events older than 7 days are dropped on hydration
* Sessions list capped at 100, oldest dropped first
* Ring buffer overflow: oldest event dropped on `addEvent()`

**Persistence loop:** every 30 seconds via `setInterval`, plus on `onDidChangeWorkspaceFolders`.

---

## 9. Build Toolchain

### Extension host
* **Tool:** esbuild
* **Input:** `src/extension.ts`
* **Output:** `dist/extension.js` (single CJS bundle)
* **External:** `['vscode']`
* **Platform:** node

### Webview
* **Tool:** Vite + `@vitejs/plugin-react`
* **Root:** `src/webview/frontend/`
* **Output:** `dist/webview/`
* **Entry filename:** `assets/index.js` (no hash, for predictable URI construction)

### TypeScript configuration
Two separate tsconfigs:

`tsconfig.json` (extension host):
* `"module": "commonjs"`, `"target": "ES2020"`
* `"lib": ["ES2020"]` — **no DOM**
* `"exclude": ["src/webview/frontend/**"]`

`src/webview/frontend/tsconfig.json` (webview):
* `"module": "ESNext"`, `"moduleResolution": "bundler"`
* `"lib": ["ES2020", "DOM"]`
* `"jsx": "react-jsx"`

### Scripts
```json
{
  "build:ext":     "node esbuild.config.mjs",
  "build:webview": "vite build --config vite.config.ts",
  "build":         "npm run build:ext && npm run build:webview",
  "watch:ext":     "node esbuild.config.mjs --watch",
  "watch:webview": "vite build --watch --config vite.config.ts",
  "typecheck":     "tsc --noEmit && tsc -p src/webview/frontend/tsconfig.json --noEmit",
  "vscode:prepublish": "npm run build"
}
```

---

## 10. Performance Considerations
* Debounce all UI updates (tree views + webview postMessage) at **250ms**
* Status bar updates synchronously (no debounce) — it's fast and the most glanced surface
* `fs.watch` tail-reading: read only last 512 bytes per change event, never re-read entire file
* globalState write: serialize once per 30s interval, not on every event
* Memory: ring buffer cap (5,000 events) + session cap (100) keeps in-memory footprint bounded

---

## 11. File Structure

```
src/
  extension.ts
  state/
    store.ts
    sessions.ts
    usage.ts
  collectors/
    claude.ts
    codex.ts
    detector.ts
  ui/
    statusBar.ts
    tree/
      summaryProvider.ts
      recentProvider.ts
  webview/
    panel.ts
    frontend/
      index.html
      main.tsx
      App.tsx
      tsconfig.json
      components/
        UsageBar.tsx
        AgentCard.tsx
        ContextMeter.tsx
        SessionCard.tsx
        EventList.tsx
media/
  icon.svg
.vscode/
  launch.json
  tasks.json
.github/
  workflows/
    build.yml
```

---

## 12. Development Phases

* **Phase 0 — Scaffold:** package.json manifest, tsconfigs, build configs, .vscode launch setup, GitHub repo creation
* **Phase 1 — State:** Store, sessions, usage stats — pure TypeScript, no VS Code dependencies
* **Phase 2 — Collectors:** Three-tier detection for both agents
* **Phase 3 — Status Bar:** Simplest always-visible UI; validates that collection works end-to-end
* **Phase 4 — Sidebar Trees:** Summary and Recent views
* **Phase 5 — Webview Dashboard:** React frontend + panel host
* **Phase 6 — Entry Point:** `extension.ts` wires all phases together
* **Phase 7 — CI:** GitHub Actions build workflow

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Neither extension exposes a public API | JSONL file watching (Tier 2) is the real workhorse — both extensions write session files |
| JSONL format changes | Parse defensively; log failures to output channel; fall through to heuristic |
| Extensions don't write session files | Heuristic Tier 3 + manual `recordPrompt` command as last resort |
| `fs.watch` recursive on Linux | Per-subdirectory watcher fallback |
| globalState size | Ring buffer cap + pruning on hydrate |

---

## 14. Design Philosophy

This should feel like:
* Native to VS Code
* Fast and quiet
* Data-first
* Not flashy
* Useful in <1 second glance

Detection accuracy is best-effort and visible — when in doubt, the UI should make it easy to manually correct counts rather than hiding uncertainty.
