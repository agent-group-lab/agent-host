# @agent-group-lab/agent-host-runtime-node

Node runtime entry package for `@agent-group-lab/agent-host`.

## Current status

This package is in active migration stage.
- Host/worker runtime assembly and Node UDS/FileStore implementation now live in this package.
- Client helper APIs now live in this package.

## Exports

- `@agent-group-lab/agent-host-runtime-node/client/uds`
  - Client APIs over UDS transport.
- `@agent-group-lab/agent-host-runtime-node/client/websocket`
  - Client APIs over websocket transport.
- `@agent-group-lab/agent-host-runtime-node/host/uds`
  - Host APIs: `startHostService`, `FileStore`, `InMemoryStore`
- `@agent-group-lab/agent-host-runtime-node/worker/uds`
  - Worker API over UDS transport.
- `@agent-group-lab/agent-host-runtime-node/worker/websocket`
  - Worker API over websocket transport.

## Migration intent

- Keep Node runtime implementation in this package.
- Continue reducing Node/runtime concerns from `@agent-group-lab/agent-host`.
