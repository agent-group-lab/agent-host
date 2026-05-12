# agent-host

A runtime framework for orchestrating AI agents in a host–worker architecture, supporting multiple AI providers (Claude, Codex) and transport protocols (UDS, WebSocket).

The **host** manages task scheduling, worker registration, and session state. **Workers** are AI agents that connect to the host, claim tasks, and execute them using a configured provider.

## Packages

| Package | Description |
|---|---|
| [`@agent-group-lab/contracts`](./packages/contracts) | Shared type contracts: agent, work, events, timeline, messages |
| [`@agent-group-lab/protocol`](./packages/protocol) | Wire protocol for host–worker communication |
| [`@agent-group-lab/provider-adapter`](./packages/provider-adapter) | Adapters for AI providers (Claude, Codex) and MCP servers |
| [`@agent-group-lab/agent-host`](./packages/agent-host) | Core host and worker runtime (state machine, task board, policies) |
| [`@agent-group-lab/agent-host-runtime-node`](./packages/agent-host-runtime-node) | Node.js transports: UDS and WebSocket |

## Installation

```bash
npm install @agent-group-lab/agent-host-runtime-node
```

For low-level access to the core runtime:

```bash
npm install @agent-group-lab/agent-host
```

## Usage

### Start a host (UDS)

```ts
import { startHostService } from '@agent-group-lab/agent-host-runtime-node/host/uds';

const host = await startHostService({
  socketPath: '/tmp/agent-host.sock',
  onLog: (msg) => console.log(msg),
  onAgentEvent: (event) => console.log('agent event', event),
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await host.close();
});
```

With a persistent store:

```ts
const host = await startHostService({
  socketPath: '/tmp/agent-host.sock',
  storeDir: './data',         // persists state to disk
});
```

### Start a worker (UDS)

```ts
import { createWorkerService } from '@agent-group-lab/agent-host-runtime-node/worker/uds';

const worker = createWorkerService({
  endpoint: '/tmp/agent-host.sock',
  adapterId: 'claude',        // 'claude' | 'codex'
  agentName: 'my-agent',
  onLog: (msg) => console.log(msg),
});

worker.start();
```

### Custom store

Implement `IHostStore` to use your own persistence layer (database, Redis, etc.):

```ts
import type { IHostStore } from '@agent-group-lab/agent-host/host';
import { startHostService } from '@agent-group-lab/agent-host-runtime-node/host/uds';

class MyStore implements IHostStore {
  // ...
}

const host = await startHostService({
  socketPath: '/tmp/agent-host.sock',
  store: new MyStore(),
});
```

## Development

### Requirements

- Node.js `>=24.0.0 <25.0.0`
- pnpm `10.x`

```bash
corepack enable
pnpm install
pnpm build
```

### Run checks

```bash
pnpm check:affected    # lint / type-check / test / build affected packages only
```

## Project structure

```
packages/
  contracts/                shared type contracts
  protocol/                 wire protocol
  provider-adapter/         AI provider adapters
  agent-host/               core host + worker runtime
  agent-host-runtime-node/  Node.js transports

infra/
  tsconfig-presets/         shared TypeScript configs
  toolkit/                  internal CLI tools
```
