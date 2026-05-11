# @agent-group-lab/protocol

## Rules & Guardrails

- Never introduce `any` in schemas or types — use `unknown` or specific Zod types.
- Never skip schema validation when parsing inbound frames — always use `parseProtocolEnvelope` or `safeParseProtocolEnvelope`.
- Do NOT import this package into browser bundles without verifying tree-shaking; it is ESM-only.
- Do NOT add new control message types without updating `ControlStateMachine`'s `VALID_TRANSITIONS` map.
- Sequence numbers (`seq`) MUST be non-negative integers; never send `undefined` or negative values.
- All schema changes must have a corresponding Vitest test update — run `pnpm run check:test --filter @agent-group-lab/protocol` to validate.
- Ask for confirmation before changing `PROTOCOL_VERSION` — it is a breaking wire-format change.

---

## Core Project Context

- **Package name:** `@agent-group-lab/protocol`
- **Type:** ESM-only (`"type": "module"`), private workspace package
- **Key runtime dependencies:** `zod@4.3.6`, `nanoid@5.1.6`
- **Output:** `./dist/esm/index.js` (built from `src/index.ts`)
- Repository layout:
  - `src/constants.ts` — `PROTOCOL_VERSION` and `ProtocolChannel` type
  - `src/schemas.ts` — All Zod schemas and parse helpers
  - `src/types.ts` — TypeScript types inferred from schemas; `IProtocolEnvelope<TType, TPayload>` generic
  - `src/errors.ts` — `ProtocolError` class and factory functions
  - `src/state-machine.ts` — `ControlStateMachine` for connection lifecycle
  - `src/ndjson.ts` — NDJSON framing: `createEnvelope`, `encodeEnvelopeFrame`, `decodeEnvelopeFrames`
  - `src/transport.ts` — `ITransport<TMessage>` interface and supporting types (no implementation)
  - `src/index.ts` — Re-exports everything; this is the only public entry point
- Primary commands:
  - Build: `pnpm run build --filter @agent-group-lab/protocol`
  - Test: `pnpm run check:test --filter @agent-group-lab/protocol`
  - Type check: `pnpm run check:type --filter @agent-group-lab/protocol`
  - Lint: `pnpm run check:lint --filter @agent-group-lab/protocol`

---

## Architecture Notes

- **Protocol versioning:** `PROTOCOL_VERSION = 1` is hard-coded in `src/constants.ts:1`. All envelopes carry `v: number`; implementations must reject mismatches.
- **Schema-driven types:** TypeScript types in `src/types.ts` are 100% inferred from Zod schemas via `z.infer<>`. Never hand-write types that duplicate schema definitions.
- **Discriminated union:** `IControlMessage` is discriminated on the `type` field. Adding a new control message requires a new Zod schema, a new entry in the union, and a new state-machine transition.
- **State machine transitions** (`src/state-machine.ts`):
  - `init` → accepts `control:hello`, `control:error`
  - `hello` → accepts `control:ready`, `control:error`
  - `ready` / `active` → accepts `control:heartbeat`, `control:ack`, `control:events-since-request`, `control:events-since-result`, `control:error`
  - `closed` → accepts nothing; terminal state
  - Use `expectCanAccept(type)` to throw on invalid transitions; use `canAccept(type)` for guards.
- **NDJSON framing** (`src/ndjson.ts`):
  - One JSON object per line; framing format: `"${JSON.stringify(message)}\n"`.
  - `decodeEnvelopeFrames(chunk, previousRest?)` handles partial frames — always pass `rest` between calls.
  - Decode errors throw `ProtocolFrameDecodeError` which includes the raw `frame` string.
- **Error stratification** (`src/errors.ts`):
  - `retryable` — transient; client should retry
  - `fatal` — unrecoverable; client must close
  - `protocol` — spec violation; treat as fatal
  - Use `toProtocolErrorPayload(error, fallbackCode?)` to convert arbitrary `Error` instances to wire-safe payloads.
- **Transport interface** (`src/transport.ts`): Defines `ITransport<TMessage>` contract only. Concrete implementations live in other packages. `subscribe()` returns an unsubscribe function.
- **Channel format** (`src/constants.ts`): Valid patterns are `'control'`, `'room:<id>'`, `'task:<id>'`, `'direct:<id>'`. The Zod `protocolChannelSchema` enforces this at parse time.
- **Trace context** (`IProtocolTrace`): Optional `taskId`, `turnId`, `spanId` for distributed tracing. Never required; never assert presence.
- **Unknown fields:** Zod schemas strip unknown fields (forward compatibility). Do not rely on pass-through of extra envelope properties.

---

## Coding Style

- Language: TypeScript strict. Async/await preferred.
- Formatting: Biome, 2-space indent, single quotes, trailing commas.
- File naming: kebab-case (e.g., `state-machine.ts`).
- Interfaces: MUST be prefixed with `I` (e.g., `IProtocolEnvelope`, `ITransport`).
- Imports: use `~/*` alias for intra-package imports (maps to `./src/*`).
- Avoid `any`; prefer `unknown` or narrow Zod types.
- Return types: infer where possible; annotate public API signatures.
- Arrow functions for class methods to preserve `this` binding (see `ControlStateMachine`).
- Require curly braces on all control statements.

---

## Output & Collaboration Expectations

- Reference touched files as `common/protocol/src/file.ts:LINE`.
- Prefer minimal diffs; avoid rewriting whole files.
- When adding a control message type, list all files that need updating: `schemas.ts`, `types.ts`, `state-machine.ts`, and the relevant test files.
- Run `pnpm run check:type --filter @agent-group-lab/protocol` and `pnpm run check:test --filter @agent-group-lab/protocol` to confirm any change.

---

## Examples & Patterns

### Creating and encoding an envelope

```typescript
import { createEnvelope, encodeEnvelopeFrame } from '@agent-group-lab/protocol';

const envelope = createEnvelope({
  seq: 1,
  type: 'control:hello',
  channel: 'control',
  payload: { protoVersion: 1, appVersion: '1.0.0', capabilitiesHash: 'abc' },
});

const frame = encodeEnvelopeFrame(envelope); // '{"v":1,"id":"...","ts":...,...}\n'
```

### Decoding a streaming chunk

```typescript
import { decodeEnvelopeFrames } from '@agent-group-lab/protocol';

let rest = '';
function onChunk(chunk: string) {
  const { messages, rest: newRest } = decodeEnvelopeFrames(chunk, rest);
  rest = newRest;
  for (const msg of messages) {
    // msg is IProtocolEnvelope
  }
}
```

### Using the state machine

```typescript
import { ControlStateMachine } from '@agent-group-lab/protocol';

const sm = new ControlStateMachine();
sm.expectCanAccept('control:hello');   // throws if not valid
sm.apply('control:hello');             // transitions to 'hello'
sm.apply('control:ready');             // transitions to 'ready'
```

### Creating protocol errors

```typescript
import { createRetryableProtocolError, createFatalProtocolError, toProtocolErrorPayload } from '@agent-group-lab/protocol';

const err = createRetryableProtocolError('Connection timeout', { attempt: 3 });
const payload = toProtocolErrorPayload(err); // safe to transmit on wire
```

### Adding a new control message type

1. Add Zod schema to `src/schemas.ts` with a unique `type` literal.
2. Add the schema to the `controlMessageSchema` union in `src/schemas.ts`.
3. Run `pnpm run check:type --filter @agent-group-lab/protocol` — types in `src/types.ts` update automatically via inference.
4. Add valid-from states to `VALID_TRANSITIONS` in `src/state-machine.ts`.
5. Add tests to `src/schemas.test.ts` and `src/state-machine.test.ts`.
