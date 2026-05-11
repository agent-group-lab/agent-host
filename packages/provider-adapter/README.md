# @agent-group-lab/provider-adapter

## Rules & Guardrails

- Never commit API keys, tokens, or provider credentials — rely on env vars at runtime.
- Never call `IToolDefinition.handler` across process boundaries — handlers are in-process closures only.
- Do NOT add a new provider without implementing all `IProviderAdapter` members: `id`, `displayName`, `capabilities()`, and `runTurn()`.
- Do NOT import `./claude` or `./codex` subpath into the main `src/index.ts` — keep the entry points separate to allow consumers to tree-shake provider implementations.
- Do NOT modify `IRunTurnRequest` or `AgentEvent` without asking for confirmation — these are wire-format contracts shared by all adapters and consumers.
- Do NOT add JSON Schema constraint conversions (e.g., `minLength`, `pattern`, numeric bounds) to `convertJsonSchemaToZodShape()` without tests — the converter is intentionally minimal.
- Always run `pnpm run check:type --filter @agent-group-lab/provider-adapter` and `pnpm run check:test --filter @agent-group-lab/provider-adapter` before committing changes.

---

## Core Project Context

- **Package name:** `@agent-group-lab/provider-adapter`
- **Type:** ESM-only (`"type": "module"`), private workspace package
- **Key runtime dependencies:** `@anthropic-ai/claude-agent-sdk@0.2.49`, `@openai/codex-sdk@0.104.0`, `zod@4.3.6`, `nanoid@5.1.6`
- **Subpath exports:**
  - `@agent-group-lab/provider-adapter` → `src/index.ts` (registry + shared types only)
  - `@agent-group-lab/provider-adapter/claude` → `src/claude/index.ts` (`ClaudeAdapter` + Claude utils)
  - `@agent-group-lab/provider-adapter/codex` → `src/codex/index.ts` (`CodexAdapter` + Codex utils)
- Repository layout:
  - `src/types.ts` — All shared interfaces and the `AgentEvent` discriminated union
  - `src/shared.ts` — `createEvent()` factory (auto-generates `id` and `ts`)
  - `src/registry.ts` — `AdapterRegistry` (Map-backed store for `IProviderAdapter` instances)
  - `src/index.ts` — Re-exports `AdapterRegistry` and all types; no adapter imports
  - `src/claude/index.ts` — `ClaudeAdapter` implementation
  - `src/claude/event-mapper.ts` — `mapClaudeEvent()` and `IMapperState`
  - `src/claude/json-schema-to-zod.ts` — `convertJsonSchemaToZodShape()` for tool injection
  - `src/codex/index.ts` — `CodexAdapter` implementation
  - `src/codex/event-mapper.ts` — `mapCodexEvent()` for Codex events
- Primary commands:
  - Build: `pnpm run build --filter @agent-group-lab/provider-adapter`
  - Test: `pnpm run check:test --filter @agent-group-lab/provider-adapter`
  - Type check: `pnpm run check:type --filter @agent-group-lab/provider-adapter`
  - Lint: `pnpm run check:lint --filter @agent-group-lab/provider-adapter`

---

## Architecture Notes

- **Adapter Pattern:** Every provider implements `IProviderAdapter` (`src/types.ts`). `runTurn()` returns `AsyncIterable<AgentEvent>` — consumers must use `for await...of` and never assume synchronous delivery.
- **Registry:** `AdapterRegistry` (`src/registry.ts`) is a plain Map wrapper. It does NOT manage lifecycle — callers own adapter instances. Register once; retrieve by `id` string.
- **Event factory:** ALL events MUST be created via `createEvent()` in `src/shared.ts`. This ensures `id` (nanoid) and `ts` (Date.now()) are always present and consistent.
- **Event mapper statefulness:**
  - Each `runTurn()` call allocates a fresh `IMapperState` — do NOT reuse state across turns.
  - State tracks `turnStarted`, `seenToolIds`, `toolNamesById`, and `completedToolIds` to prevent duplicate event emissions.
  - Claude maps tool IDs (internal SDK concept) to tool names; Codex maps `server/tool` name pairs.
- **AgentEvent discriminated union** (`src/types.ts`): Discriminated on `type`. All events carry `id`, `ts`, `turnId`, `taskId`, `adapterId`. Specific payloads per event type:
  - `turn:start` / `turn:end` — no extra payload
  - `text:delta` — `content: string` (streaming chunk)
  - `text:done` — `content: string` (full block)
  - `tool:start` — `toolName: string`, `args: Record<string, unknown>`
  - `tool:done` — `toolName: string`, `output: unknown`, `isError: boolean`
  - `file:change` — `filePath: string`, `operation: 'add' | 'update' | 'delete'`
  - `error` — `message: string`, `fatal: boolean`
- **Claude-specific constraints:**
  - Claude adapter resolves the CLI executable in order: `CLAUDE_CODE_EXECUTABLE` env var → `./node_modules/@anthropic-ai/claude-agent-sdk/cli.js` → SDK module directory. Never hardcode paths.
  - Session persistence: `session_id` is stored on the adapter instance; the adapter MUST be kept alive across turns for multi-turn memory. Creating a new `ClaudeAdapter` per turn loses history.
  - Tools are injected via an in-process MCP server under the `'swarm-tools'` namespace. Tool handlers return serialized strings (JSON-stringified if object).
  - `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true` are always set — this is intentional for agent execution contexts.
- **Codex-specific constraints:**
  - `IToolDefinition[]` in `IRunTurnRequest.tools` is silently ignored — Codex manages tools natively (MCP or command execution).
  - Thread is created on first `runTurn()` with `workingDirectory` set at creation time (immutable per thread).
  - `thread_id` is stored on the adapter instance and reused via `resumeThread()` if the in-memory `Thread` object is lost.
  - The adapter instance MUST be reused across turns to share the same thread or persisted `thread_id`.
- **JSON Schema → Zod conversion** (`src/claude/json-schema-to-zod.ts`):
  - Supports: `string`, `number`, `integer`, `boolean`, `array`, `object`, `null`, `const`, `enum` (string values only), `anyOf`/`oneOf` unions.
  - Does NOT support: `minLength`, `maxLength`, `pattern`, numeric bounds. These constraints are silently dropped.
  - Throws `Error` if the top-level schema is missing `properties`.

---

## Coding Style

- Language: TypeScript strict. Async/await; `AsyncIterable` for streaming.
- Formatting: Biome, 2-space indent, single quotes, trailing commas.
- File naming: kebab-case (e.g., `event-mapper.ts`, `json-schema-to-zod.ts`).
- Interfaces: MUST be prefixed with `I` (e.g., `IProviderAdapter`, `IRunTurnRequest`).
- Imports: use `~/*` alias for intra-package imports (maps to `./src/*`).
- Avoid `any`; use `unknown` for tool outputs, handler results, and error details.
- Return types: infer where possible; annotate `IProviderAdapter` method signatures explicitly.
- Arrow functions for class methods to preserve `this` binding (all adapter classes use this pattern).
- Require curly braces on all control statements.
- Co-locate test files alongside source: `event-mapper.test.ts` next to `event-mapper.ts`.

---

## Output & Collaboration Expectations

- Reference files as `common/provider-adapter/src/file.ts:LINE`.
- Prefer minimal diffs; avoid rewriting whole adapter classes.
- When adding a new provider, list all new files required: `src/<name>/index.ts`, `src/<name>/event-mapper.ts`, subpath entry in `package.json`, and export in subpath `src/<name>/index.ts`.
- When modifying `AgentEvent` or `IRunTurnRequest`, confirm the change — all adapters and downstream consumers are affected.
- Run `pnpm run check:type --filter @agent-group-lab/provider-adapter` and `pnpm run check:test --filter @agent-group-lab/provider-adapter` to validate any change.

---

## Examples & Patterns

### Using the registry

```typescript
import { AdapterRegistry } from '@agent-group-lab/provider-adapter';
import { ClaudeAdapter } from '@agent-group-lab/provider-adapter/claude';
import { CodexAdapter } from '@agent-group-lab/provider-adapter/codex';

const registry = new AdapterRegistry();
registry.register(new ClaudeAdapter());
registry.register(new CodexAdapter());

const adapter = registry.get('claude'); // undefined if not registered
```

### Running a turn and consuming events

```typescript
if (!adapter) throw new Error('Adapter not found');

for await (const event of adapter.runTurn({
  taskId: 'task-123',
  turnId: 'turn-1',
  prompt: 'List all files in the current directory',
  workingDirectory: '/tmp/workspace',
  tools: [], // optional; ignored by Codex
  systemPromptSuffix: 'Be concise.', // optional; Claude only
})) {
  if (event.type === 'text:delta') {
    process.stdout.write(event.content);
  } else if (event.type === 'error' && event.fatal) {
    throw new Error(event.message);
  }
}
```

### Creating a normalized event inside an adapter

```typescript
import { createEvent } from '~/shared';

const evt = createEvent({
  type: 'text:delta',
  turnId: request.turnId,
  taskId: request.taskId,
  adapterId: this.id,
  content: chunk,
});
// evt.id and evt.ts are auto-generated
yield evt;
```

### Adding a new provider adapter

1. Create `src/<name>/index.ts` implementing `IProviderAdapter`.
2. Create `src/<name>/event-mapper.ts` mapping provider events to `AgentEvent`.
3. Add subpath to `package.json` exports: `"./<name>": "./dist/esm/<name>/index.js"`.
4. Add subpath to `tsconfig.json` if path aliases are needed.
5. Write event mapper tests in `src/<name>/event-mapper.test.ts`.
6. Run `pnpm run check:type --filter @agent-group-lab/provider-adapter` and `pnpm run check:test --filter @agent-group-lab/provider-adapter`.
