# @agent-group-lab/contracts

Canonical source for cross-package business contracts.  
This package is runtime-neutral and provides only shared types/constants/schemas/codecs.

## What it Exports

- Agent models and adapter contracts
  - `ICapabilities`, `IToolDefinition`, `IRunTurnRequest`, `IProviderAdapter`
- Agent and domain actions
  - `AgentAction`, `CommunicationAction`, `CommitmentAction`
- Work state contracts
  - `WorkState`, `WorkStateKind`
- Event contracts
  - `ITransitionEvent`, event semantic aliases
- Timeline core contracts
  - `IReplayCursor`, `IHostCheckpoint`, `ITimelineEntry`
- Message contracts
  - Message name constants (command/reply/notification)
  - Payload types + zod payload schemas (`messages/*`)
  - Registry API (`messageRegistryEntries`, `getMessageEntry`, `getMessagesByCategory`, `validatePayload`)
  - Host message union (`hostMessageTypes`, `HostMessageType`)
- Shared payload codec
  - `parse*Payload`, `isRecord`

## Source Layout

- `src/messages/command/*` command message constants + payload schema/types
- `src/messages/reply/*` reply message constants + payload schema/types
- `src/messages/notification/*` notification message constants + payload schema/types
- `src/messages/registry.ts` message registry metadata
- `src/messages/host-message-types.ts` host message union (derived from `messageRegistryEntries`)
- `src/messages/payload-codec.ts` shared payload parser helpers
- `src/events/*` transition event contracts + semantic aliases
- `src/agent/*` agent domain contracts (models/actions)
- `src/work/*` work domain contracts
- `src/timeline/*` host/runtime timeline core primitives

## Public Entry

- Do not import from `@agent-group-lab/contracts` root.
- Use domain entry points:
  - `@agent-group-lab/contracts/agent`
  - `@agent-group-lab/contracts/work`
  - `@agent-group-lab/contracts/events`
  - `@agent-group-lab/contracts/timeline`
  - `@agent-group-lab/contracts/messages`

Business-facing timeline ingest/live contracts now live in `@common/biz-contracts`.

## Validation Commands

- `pnpm --filter @agent-group-lab/contracts check:type`
- `pnpm --filter @agent-group-lab/contracts check:test`
- `pnpm --filter @agent-group-lab/contracts check:dep`
