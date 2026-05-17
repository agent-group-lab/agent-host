# agent-host

A runtime framework for orchestrating AI agents in a host–worker architecture, supporting multiple AI providers (Claude, Codex) and transport protocols (UDS, WebSocket).

The **host** manages task scheduling, worker registration, and session state. **Workers** are AI agents that connect to the host, claim tasks, and execute them using a configured provider.

## Quick Start

Requirements:

- Node.js `>=24.0.0 <25.0.0`
- Bun `>=1.3`
- pnpm `11.x`

Install dependencies.

```bash
pnpm install
```

Start a local host in one terminal. By default this uses the UDS endpoint
`/tmp/swarm-host.sock` and stores host state in `.agent-host`.

```bash
pnpm nx run @agent-group-lab/agent-host-runtime-node:host:uds
```

Build the TUI executable in another terminal.

```bash
pnpm nx run @agent-group-lab/tui:bundle
```

Start the TUI against the default local host.

```bash
packages/tui/dist/tui --name lead --adapter codex
```

For WebSocket transport, start the host with its default endpoint
`ws://127.0.0.1:8787`, then pass that endpoint to the TUI.

```bash
pnpm nx run @agent-group-lab/agent-host-runtime-node:host:ws
packages/tui/dist/tui --connect ws://127.0.0.1:8787 --name lead --adapter codex
```

## Packages

| Package | Description |
|---|---|
| [`@agent-group-lab/contracts`](./packages/contracts) | Shared type contracts: agent, work, events, timeline, messages |
| [`@agent-group-lab/protocol`](./packages/protocol) | Wire protocol for host–worker communication |
| [`@agent-group-lab/provider-adapter`](./packages/provider-adapter) | Adapters for AI providers (Claude, Codex) and MCP servers |
| [`@agent-group-lab/agent-host`](./packages/agent-host) | Core host and worker runtime (state machine, task board, policies) |
| [`@agent-group-lab/agent-host-runtime-node`](./packages/agent-host-runtime-node) | Node.js transports: UDS and WebSocket |
