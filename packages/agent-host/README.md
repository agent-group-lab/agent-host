# @agent-group-lab/agent-host

## Rules & Guardrails

- Never add a second active task to a worker — `TaskExecutor` rejects new tasks while one is running; enforce this at the handler level.
- Never create circular task dependencies — `validateNoCycle()` in `src/domain/task-board.ts` must be called before any dependency is added.
- Never allow a worker to send a direct request to itself — `DirectAdmissionGuard` must always reject `fromAgentId === toAgentId`.
- Never transition a commitment out of a terminal state (`delivered`, `failed`, `breached`) — `transitionCommitmentState()` throws on invalid transitions.
- Never dispatch work to an offline worker — always gate dispatch behind `Mailbox.isOnline()`.
- Never add a new message type to `HostMessageType` without wiring it into `HostCore`'s dispatch table and adding a codec entry.
- Never skip role-policy validation in `CommitmentHandler` — call `getRolePolicy(role).allowedActions` before processing any `commitment:action`.
- Never issue overlapping `task:claim` requests outside `ClaimLoop` control — keep `canRequestClaim()` as the single gate for pending claim concurrency.
- Never start duplicated waits for the same parent task — `WaitManager.startWaitForChildren()` must keep one active wait per `parentTaskId`.
- Never execute a claimed assignment with mismatched token — workers must reject mismatched `assignmentToken` via `task:failed`.
- Ask for confirmation before modifying any state-machine transition table (`work-state.ts`, `commitment.ts`, `delegation.ts`, `task-board.ts`, `inbox.ts`) — these are shared invariants across host and worker.
- Always run `pnpm run check:type --filter @agent-group-lab/agent-host` and `pnpm run check:test --filter @agent-group-lab/agent-host` before committing.

---

## Core Project Context

- **Package name:** `@agent-group-lab/agent-host`
- **Type:** ESM-only (`"type": "module"`), private workspace package
- **Internal dependencies:** `@agent-group-lab/protocol` (workspace:\*), `@agent-group-lab/contracts` (workspace:\*)
- **Dependency boundary:** core package depends only on contracts/protocol and does not depend on `apps/cli`.
- Subpath exports:
  - `@agent-group-lab/agent-host` — Shared domain/message types（无 runtime 组装 API）
  - `@agent-group-lab/agent-host/host` — Host core: `HostCore`, `IHostStore`, `InMemoryStore` 及 domain types
  - `@agent-group-lab/agent-host/worker` — Worker core: `WorkerCore` 及 worker types
- Repository layout:
  - `src/domain/` — Pure domain models and state machines (no I/O)
  - `src/host/` — Host-side runtime, layered into four sub-areas:
    - `src/host/host-core.ts` — Top-level orchestrator; owns service construction, handler wiring, and message dispatch
    - `src/host/handlers/` — Per-message-type handler classes (see Handlers table below)
    - `src/host/services/` — Shared stateless domain services (see Services table below)
    - `src/host/infra/` — Infrastructure primitives: connection management, messaging, inbox, mailbox, breach detection, lease reaping (see Infra table below)
  - `src/worker/` — Worker-side execution (`WorkerCore`, `TaskExecutor`, `DelegationManager`, `DirectPeer`, `ClaimLoop`, `WaitManager`, `PeerDirectory`, `ReconnectLoop`, `ToolBuilder`)
  - `src/policy/` — Policy engines (`RolePolicy`, `Triage`, `DirectAdmissionGuard`, `Scheduler`)
  - `src/ports/` — Port interfaces (`IHostServerPort`, `IWorkerClientPort`, `IClientPort`)
  - `src/store/` — `IHostStore` interface, `InMemoryStore`
  - `src/codec/` — Inbound codec facade (re-export of `@agent-group-lab/contracts` parse APIs)
  - `src/types.ts` — Re-export bridge of shared contracts from `@agent-group-lab/contracts`
  - `src/index.ts` — Shared public types export
  - `src/host-entry.ts` — Host subpath entry
  - `src/worker-entry.ts` — Worker subpath entry
- Primary commands:
  - Build: `pnpm run build --filter @agent-group-lab/agent-host`
  - Test: `pnpm run check:test --filter @agent-group-lab/agent-host`
  - Type check: `pnpm run check:type --filter @agent-group-lab/agent-host`
  - Lint: `pnpm run check:lint --filter @agent-group-lab/agent-host`

---

## Architecture Notes

- **HostCore dispatch:** `HostCore` (`src/host/host-core.ts`) constructs all services and handlers, then dispatches incoming protocol envelopes to the appropriate handler by message type. Do NOT put multi-concern business logic in `HostCore` itself — it is the composition root only.
- **Host layering rule:** Dependencies flow strictly downward: `HostCore` → `handlers/` → `services/` → `domain/`. Handlers may call services; services must not call handlers. Infra primitives (`infra/`) may be used by both handlers and services but must not import from either.
- **Event output port:** `IEventOutputPort` (`src/ports/event-output-port.ts`) is the host-side event sink boundary. `HostCore` emits `ITransitionEvent[]` through this port.
- **WorkerCore dispatch:** `WorkerCore` (`src/worker/worker-core.ts`) similarly routes inbound host messages. `ReconnectLoop` manages reconnection with exponential backoff — do NOT add reconnect logic elsewhere.
- **ClaimLoop** (`src/worker/claim-loop.ts`): Polls `task:claim` with backoff + jitter, and applies preferred-window fast retry behavior.
- **PeerDirectory** (`src/worker/peer-directory.ts`): Fetches `workers:list` per turn with TTL cache fallback; injects peer metadata into system prompt.
- **WaitManager** (`src/worker/wait-manager.ts`): Drives `coord:wait:start/done` and `task:children:status` synchronization, including reconnect epoch recovery.
- **Port/Adapter pattern:** `IHostServerPort` and `IWorkerClientPort` define I/O boundaries. Runtime adapters live in `@agent-group-lab/agent-host-runtime-node`.
- **Storage layer:** `IHostStore` (`src/store/store.ts`) is a composite interface. Core package只内置 `InMemoryStore`; 持久化实现位于 runtime 包。Always inject the store — never instantiate storage inside handlers.
- **State machines (XState-backed, all in `src/domain/`)**:
  - **WorkState** — 8 states; one active task per worker; transitions enforced by `transitionWorkState()`
  - **CommitmentStatus** — `none → accepted → (delivered | failed | breached)`; terminal states are immutable
  - **DelegationStatus** — `pending → accepted → (completed | rejected)`; role gates: `lead` and `executor` can delegate, `reviewer` cannot
  - **TaskBoardStatus** — creation can start at `blocked` when dependencies are unresolved; transitions include `assigned → todo` rollback and `doing → blocked|done|cancelled`
  - **InboxEntryStatus** — `queued → reserved → dispatched → (completed | dropped)`; priority-sorted dispatch candidates
- **Message type registry:** Host message contracts live in `@agent-group-lab/contracts` (`HostMessageType` + payload interfaces), and `src/types.ts` provides local re-exports. Codec parsing for each type lives in `src/codec/`. Adding a new type requires: contract update in `@agent-group-lab/contracts`, codec entry, handler class, and dispatch wiring in `HostCore`.
- **DirectAdmissionGuard** (`src/policy/direct-admission-guard.ts`): Runs 8 validation checks in order — sender identity, self-direct rejection, online status, queue depth (default 32), TTL, hop count (default max 3), loop detection, rate limit (default 20 req/60s). All defaults are overridable via `IDirectAdmissionGuardOptions`.
- **Triage policy** (`src/policy/triage.ts`): Determines deliver/defer/drop for direct requests based on target worker's current `WorkState`. Rules are priority-ordered; default: idle/finished → deliver (10), blocked → deliver (15), focused/waiting → defer (20).
- **Scheduler** (`src/policy/scheduler.ts`): Selects assignee by: explicit `agentId` first → role filter → first online worker. Never assigns to offline workers.
- **BreachDetector** (`src/host/infra/breach-detector.ts`): Background interval scans all `accepted` commitments for expired `slaDeadline`. Triggers `BreachHandler` on violation; transitions commitment to `breached`.
- **ClaimLeaseReaper** (`src/host/infra/claim-lease-reaper.ts`): Runs only when claim mode is enabled; periodically releases expired claim leases.
- **Agent events:** Workers publish `agent:event` envelopes; `AgentEventHandler` forwards them to the task requester's connection. These carry `IAgentEventPayload` which wraps `AgentEvent` from `@agent-group-lab/contracts`.
- **Claim + DAG coordination:** `task:publish-batch`, `task:claim`, `task:children:status`, and `coord:wait:*` are the claim-mode orchestration path used by `publish_claimable_tasks` and `wait_for_children`.
- Runtime entrypoints (`startHostService`, `startWorkerService`, client commands, `FileStore`) are provided by `@agent-group-lab/agent-host-runtime-node`.
- **Protocol flow doc:** See `docs/flow.md` for full sequence diagrams and complete WorkState transition table.

---

## Coding Style

- Language: TypeScript strict. Async/await throughout; `AsyncIterable` for streaming agent events.
- Formatting: Biome, 2-space indent, single quotes, trailing commas.
- File naming: kebab-case (e.g., `host-core.ts`, `work-state.ts`, `breach-detector.ts`).
- Interfaces: MUST be prefixed with `I` (e.g., `IHostStore`, `ICommitmentRecord`, `IDirectRequestPayload`).
- Imports: use `~/*` alias for intra-package imports (maps to `./src/*`).
- Avoid `any`; use `unknown` for artifact payloads, tool outputs, and error details.
- Arrow functions on ALL class methods to ensure lexical `this` binding — this applies to all handler and manager classes.
- Require curly braces on all control statements.
- Co-locate test files: `src/domain/commitment.test.ts` next to `src/domain/commitment.ts`.
- Tests: use `InMemoryStore`, mock ports with `createMockConnection()`, and helper functions (`makeReady`, `registerWorker`). Never hit real UDS sockets in tests.

---

## Output & Collaboration Expectations

- Reference files as `common/agent-host/src/path/file.ts:LINE`.
- Prefer minimal diffs; avoid rewriting handler classes wholesale.
- When adding a new host message type, list all files to touch: `src/types.ts`, `src/codec/`, handler class, `HostCore` dispatch wiring, test — and decide whether the new payload type belongs in the default export (`src/index.ts`) or the host-only export (`src/host-entry.ts`).
- When modifying a state-machine transition table, confirm the change — downstream handlers and tests depend on these invariants.
- Run `pnpm run check:type --filter @agent-group-lab/agent-host` and `pnpm run check:test --filter @agent-group-lab/agent-host` to validate any change.

---

## Examples & Patterns

### Core + Runtime split

```typescript
import { HostCore, InMemoryStore } from '@agent-group-lab/agent-host/host';
import { startHostService } from '@agent-group-lab/agent-host-runtime-node/host';

// Core types and logic come from @agent-group-lab/agent-host
const store = new InMemoryStore();
const core = new HostCore({ store });

// Runtime composition comes from @agent-group-lab/agent-host-runtime-node
const runtime = await startHostService({
	socketPath: '/tmp/swarm-host.sock',
	store,
});
```

### Runtime client APIs

```typescript
import {
	assignTaskThroughHost,
	DEFAULT_SOCKET_PATH,
} from '@agent-group-lab/agent-host-runtime-node';

const result = await assignTaskThroughHost({
	socketPath: DEFAULT_SOCKET_PATH,
	prompt: 'Summarize the project status',
	workingDirectory: '/workspace',
});
```

### Adding a new host message type

1. Add payload interface to `src/types.ts` (prefix with `I`, e.g., `IMyNewPayload`).
2. Add type literal to `HostMessageType` union in `src/types.ts`.
3. Add codec parser in `src/codec/` that validates with Zod.
4. Create handler class in `src/host/handlers/` (arrow-function methods, inject services via constructor options).
5. Wire handler into `HostCore`'s dispatch table in `src/host/host-core.ts`.
6. Write tests in a co-located `*.test.ts` using `InMemoryStore` and mock service stubs.
7. Run `pnpm run check:type --filter @agent-group-lab/agent-host` and `pnpm run check:test --filter @agent-group-lab/agent-host`.

### Adding a new MCP tool (end-to-end)

当你要新增一个可被模型调用的 MCP tool，推荐按下面路径实现（先工具定义，再协议，再 host 处理）：

1. **定义 tool 入口**：在 `src/worker/tool-builder.ts` 增加 `inputSchema` + `buildXxxTool()`，只做入参校验和调用编排。
2. **把 tool 注入 turn context**：在 `src/worker/worker-core.ts` 的 `createTurnContext()` 把新 tool push 到 `tools` 列表。
3. **确认执行链路**：`TaskExecutor.runTurnAndCollectText()` 会将 `tools` 传给 `IProviderAdapter.runTurn()`，适配器侧通过 MCP 暴露给模型（见 `common/provider-adapter/src/codex/mcp-tool-server.ts`）。
4. **若需要 host 数据/动作，新增协议**：在 `@agent-group-lab/contracts` 新增 command/reply（`src/messages/command/*`, `src/messages/reply/*`），并更新：
   - `src/messages/registry.ts`
   - `src/messages/host-message-types.ts`
   - `src/messages/payload-codec.ts`（及导出）
5. **host 侧实现 handler**：在 `src/host/handlers/` 新建 handler，处理 command 并回复 result。
6. **接入 HostCore dispatch**：在 `src/host/host-core.ts` 注入 handler、加路由分发、补充 payload union。
7. **worker 侧请求-响应等待**：在 `src/worker/worker-core.ts` 增加 pending map + timeout，并在 inbound handler 中按 `requestId` resolve/reject。
8. **回到 tool 收敛输出**：在 `tool-builder.ts` 将协议结果整理成稳定的 tool 返回结构（模型可直接消费）。
9. **补测试并验证**：
   - contracts：`pnpm --filter @agent-group-lab/contracts run check:type` + `check:test`
   - agent-host：`pnpm --filter @agent-group-lab/agent-host run check:type` + `check:test`

---

## Host layer 组件说明

### Services (`src/host/services/`)

Services 封装可复用的领域操作，被多个 handler 共享。它们依赖 `IHostStore` 和 `onTransitionEvents`，不持有网络连接状态，不直接 dispatch。HostCore 在构造函数中创建所有 service 实例，然后注入到需要它们的 handler 中。

| Service | 文件 | 职责 |
| --- | --- | --- |
| **TaskBoardService** | `task-board-service.ts` | 任务看板状态机操作：`markDoing` / `markAssigned` / `markCancelled`；`markDone` 返回被解锁的子任务 ID 列表（不自动 dispatch，由调用方负责排队和派发）；`reassign` 更换任务负责人；`getTaskBoardMap` 返回全量快照 |
| **AgreementService** | `agreement-service.ts` | Commitment 和 Delegation 的状态转换：`applyCommitmentTransition` / `applyDelegationTransition` 各自调用领域状态机、持久化结果并 emit 事件；`findActiveDelegationByTask` 查询某 worker 对某任务的有效委托 |
| **WorkQueueService** | `work-queue-service.ts` | Inbox 工作队列管理：`ensureTaskWorkQueued` 幂等地为 todo 任务创建或替换 inbox entry；`dropInboxEntriesForWorker` 清退指定 worker 所有 queued/reserved/dispatched 条目（对 direct work 同时回写 requester 状态并发送 ACK）；`completeTaskWork` 将任务的 inbox entry 标记为 completed 或 dropped |
| **TaskNotificationService** | `task-notification-service.ts` | 任务生命周期通知：`finishTask` 将 completeWork 委托给 DispatchCoordinator（判断 done/非 done 决定 outcome）；`notifyParentTaskChildDelivered` 向父任务 worker 发送 `task:child:delivered` 及（全部完成时的）`task:children:completed`；`notifyRequesterOfFailure` 向 direct request 发起方发送失败 ACK |
| **WorkerLifecycleService** | `worker-lifecycle-service.ts` | Worker 生命周期管理：`recoverWorkerToIdle` 将 worker 从任意非 offline 状态安全过渡到 idle 并触发下一轮 dispatch；`handleWorkerDisconnect` 处理断连事件，清退 inbox、取消受影响任务并向 requester 发送 `task:failed` + `control:error` |

### Handlers (`src/host/handlers/`)

每个 handler 对应一类协议消息，只负责该消息的验证、业务分支判断和最终响应发送。复杂的状态变更通过调用 service 完成，不在 handler 内直接操作 store。

| Handler | 文件 | 处理的消息 | 职责 |
| --- | --- | --- | --- |
| **CommitmentHandler** | `commitment-handler.ts` | `commitment:action` | 处理 ACCEPT / UPDATE / DELIVER / FAIL / ESCALATE / DECLINE 六种 commitment 动作；DELIVER 路径由 `TaskBoardService.markDone` 返回解锁 ID 后手动排队 + dispatch；DECLINE 路径重新选工并调用 `WorkerLifecycleService.recoverWorkerToIdle` |
| **TaskHandler** | `task-handler.ts` | `task:assign` / `task:completed` / `task:failed` | 任务创建（push 和 claim 模式）、worker 完成上报和失败上报；`task:completed` 和 `task:failed` 均通过 `TaskBoardService` + `WorkQueueService` + `TaskNotificationService` 完成状态更新和通知 |
| **DispatchCoordinator** | `dispatch-coordinator.ts` | 内部调度（非直接响应消息） | 维护 inbox 派发循环：`dispatchNextWorkForWorker` 按优先级取候选、发 `task:assign` 或 `direct:request`；`completeWork` 收尾 inbox entry 并通过 `WorkerLifecycleService.recoverWorkerToIdle` 回收 worker；持有 deferred dispatch backoff 状态 |
| **DirectHandler** | `direct-handler.ts` | `direct:request` / `direct:response` / `direct:cancel` | P2P 消息路由：request 经 admission guard 验证后入 inbox 并触发 triage；response 路由回 requester 并回收 worker；cancel 清理 inbox entry |
| **BreachHandler** | `breach-handler.ts` | 内部调用（由 BreachDetector 触发） | SLA 违约处理：将 commitment 转为 breached、取消任务、向 requester 发送 `task:failed` |
| **TaskClaimHandler** | `task-claim-handler.ts` | `task:claim` | Pull 模式任务认领：选取可认领任务并写入 claim lease，先发 `task:claim:result` 再排队 dispatch；dispatch 失败时回滚 lease 和 delegation |
| **TaskPublishBatchHandler** | `task-publish-batch-handler.ts` | `task:publish-batch` | 批量发布任务 DAG：原子模式下任一节点校验失败则整批拒绝；成功后批量写 store 并调用 `WorkQueueService.ensureTaskWorkQueued` 触发派发 |
| **TaskChildrenStatusHandler** | `task-children-status-handler.ts` | `task:children:status` | 查询父任务的所有子任务状态汇总，返回 done/cancelled/inProgress/todo/blocked 计数及 `allChildrenTerminal` 标志 |
| **TaskListHandler** | `task-list-handler.ts` | `task:list` | 按 taskIds 查询任务状态详情，返回 `tasks` 和 `missingTaskIds`（可选 artifact） |
| **CoordinationHandler** | `coordination-handler.ts` | `coord:wait:start` / `coord:wait:done` | 管理 worker 的 `waiting_delegation` 状态切换，支持 `wait_for_children` 工具的协调信号 |
| **AgentEventHandler** | `agent-event-handler.ts` | `agent:event` | 将 agent 运行事件转发给任务 requester；根据事件类型推断 worker 的下一个 WorkState（`tool:start` → `waiting_tool`，`tool:done` → `focused`，`error{fatal}` → `blocked`） |
| **ControlPlaneHandler** | `control-plane-handler.ts` | `control:hello` / `control:heartbeat` / `control:error` | 连接握手（`control:ready` 响应）和心跳（`control:ack` 响应），更新 connection ready 状态 |
| **WorkerRegistryHandler** | `worker-registry-handler.ts` | `worker:register` / `workers:list` | Worker 注册（offline → idle 状态转换，写 worker record）和 worker 列表查询 |

### Infra (`src/host/infra/`)

基础设施原语，被 handlers 和 services 使用，不含业务逻辑。

| 组件 | 文件 | 职责 |
| --- | --- | --- |
| **ConnectionManager** | `connection-manager.ts` | 维护 live connection 映射（`IHostPortConnection` + `ControlStateMachine`）；提供 `open` / `close` / `getContext` / `getLiveConnection`；`open` 时初始化 control state machine，`close` 时清理连接元数据 |
| **MessageGateway** | `message-gateway.ts` | 统一信封创建和发送：`createEnvelope`（注入 seq/ts/id）、`sendToConnection`（通过 ConnectionManager 查 live connection）、`sendProtocolError` / `sendErrorPayload`（标准化 `control:error` 格式） |
| **StoreBackedInbox** | `inbox.ts` | Inbox 的实现层：按优先级排序的 dispatch 候选、幂等 transition（非法转换抛出）、按 agent + requestId 查询；接口 `IInbox` 允许测试替换 |
| **StoreBackedMailbox** | `mailbox.ts` | Worker 在线地址簿：`resolve(agentId)` 返回 connectionId（offline worker 返回 undefined）；`isOnline` 判断派发可达性 |
| **BreachDetector** | `breach-detector.ts` | 后台定时器（默认 30s）扫描所有 `accepted` commitments，对过期 `slaDeadline` 调用 `onBreach` 回调；`start` / `stop` / `scanOnce` 接口 |
| **ClaimLeaseReaper** | `claim-lease-reaper.ts` | 后台定时器（默认 5s）扫描 claim 模式的 todo 任务，释放已过期的 claim lease（清除 `assigneeId`、`assignmentToken`、`claimLeaseExpiresAt`）；仅在 `taskClaimV2Enabled` 时启动 |
