import { describe, expect, it, vi } from 'vitest';
import { createTaskBoardEntry } from '~/domain/task-board';
import { InMemoryStore } from '~/store/in-memory-store';
import { ClaimLeaseReaper } from './claim-lease-reaper';

const createDoingClaimTask = (input: {
	taskId: string;
	turnId: string;
	requesterConnectionId: string;
	assigneeId: string;
	assigneeName: string;
	assignmentToken: string;
	claimLeaseExpiresAt: number;
	executionLeaseExpiresAt: number;
}) => {
	return {
		...createTaskBoardEntry({
			taskId: input.taskId,
			turnId: input.turnId,
			prompt: 'doing task',
			workingDirectory: '/tmp',
			requesterConnectionId: input.requesterConnectionId,
			dispatchMode: 'claim',
		}),
		status: 'doing' as const,
		assigneeId: input.assigneeId,
		assigneeName: input.assigneeName,
		assignmentToken: input.assignmentToken,
		claimLeaseMs: input.claimLeaseExpiresAt,
		claimLeaseExpiresAt: input.claimLeaseExpiresAt,
		executionLeaseMs: input.executionLeaseExpiresAt,
		executionLeaseExpiresAt: input.executionLeaseExpiresAt,
		claimedAt: 100,
		startedAt: 200,
	};
};

describe('ClaimLeaseReaper', () => {
	it('releases expired todo claim leases without affecting branch 2', async () => {
		const store = new InMemoryStore();
		store.setTaskBoardEntry({
			...createTaskBoardEntry({
				taskId: 'task-todo',
				turnId: 'turn-1',
				prompt: 'todo claim',
				workingDirectory: '/tmp',
				requesterConnectionId: 'conn-requester',
				dispatchMode: 'claim',
			}),
			assigneeId: 'worker-a',
			assigneeName: 'Worker A',
			assignmentToken: 'token-1',
			claimLeaseExpiresAt: 900,
			claimedAt: 100,
		});
		const onReaped = vi.fn(async () => {});
		const onExecutionLeaseExpired = vi.fn(async () => {});
		const reaper = new ClaimLeaseReaper({
			store,
			now: () => 1_000,
			onReaped,
			onExecutionLeaseExpired,
		});

		await reaper.scanOnce();

		expect(onReaped).toHaveBeenCalledWith({
			taskId: 'task-todo',
			agentId: 'worker-a',
			token: 'token-1',
		});
		expect(onExecutionLeaseExpired).not.toHaveBeenCalled();
		expect(store.getTaskBoardEntry('task-todo')).toMatchObject({
			taskId: 'task-todo',
			assigneeId: undefined,
			assignmentToken: undefined,
			claimLeaseExpiresAt: undefined,
		});
	});

	it('does not trigger branch 2 when lease is not expired', async () => {
		const store = new InMemoryStore();
		const onExecutionLeaseExpired = vi.fn(async () => {});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-doing' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createDoingClaimTask({
				taskId: 'task-doing',
				turnId: 'turn-1',
				requesterConnectionId: 'conn-requester',
				assigneeId: 'session-agent',
				assigneeName: 'Session Agent',
				assignmentToken: 'token-2',
				claimLeaseExpiresAt: 900,
				executionLeaseExpiresAt: 1_100,
			}),
		);

		const reaper = new ClaimLeaseReaper({
			store,
			now: () => 1_000,
			onExecutionLeaseExpired,
		});

		await reaper.scanOnce();

		expect(onExecutionLeaseExpired).not.toHaveBeenCalled();
	});

	it('does not trigger branch 2 for persistent workers', async () => {
		const store = new InMemoryStore();
		const onExecutionLeaseExpired = vi.fn(async () => {});
		store.setWorker({
			agentId: 'persistent-agent',
			agentName: 'Persistent Agent',
			connectionId: 'conn-persistent',
			workerType: 'persistent',
			adapterId: 'codex',
			capabilities: {
				streaming: true,
				toolUse: true,
				codeExecution: true,
				fileRead: true,
				fileWrite: true,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-doing' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createDoingClaimTask({
				taskId: 'task-doing',
				turnId: 'turn-1',
				requesterConnectionId: 'conn-requester',
				assigneeId: 'persistent-agent',
				assigneeName: 'Persistent Agent',
				assignmentToken: 'token-3',
				claimLeaseExpiresAt: 900,
				executionLeaseExpiresAt: 900,
			}),
		);

		const reaper = new ClaimLeaseReaper({
			store,
			now: () => 1_000,
			onExecutionLeaseExpired,
		});

		await reaper.scanOnce();

		expect(onExecutionLeaseExpired).not.toHaveBeenCalled();
	});

	it('triggers branch 2 for expired session execution leases', async () => {
		const store = new InMemoryStore();
		const onExecutionLeaseExpired = vi.fn(async () => {});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-doing' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createDoingClaimTask({
				taskId: 'task-doing',
				turnId: 'turn-1',
				requesterConnectionId: 'conn-requester',
				assigneeId: 'session-agent',
				assigneeName: 'Session Agent',
				assignmentToken: 'token-4',
				claimLeaseExpiresAt: 900,
				executionLeaseExpiresAt: 900,
			}),
		);

		const reaper = new ClaimLeaseReaper({
			store,
			now: () => 1_000,
			onExecutionLeaseExpired,
		});

		await reaper.scanOnce();

		expect(onExecutionLeaseExpired).toHaveBeenCalledWith({
			taskId: 'task-doing',
			agentId: 'session-agent',
		});
	});

	it('still triggers branch 2 when no commitment record exists', async () => {
		const store = new InMemoryStore();
		const onExecutionLeaseExpired = vi.fn(async () => {});
		store.setWorker({
			agentId: 'session-agent',
			agentName: 'Session Agent',
			connectionId: undefined,
			workerType: 'session',
			adapterId: 'mcp',
			capabilities: {
				streaming: false,
				toolUse: true,
				codeExecution: false,
				fileRead: false,
				fileWrite: false,
			},
			agentRole: 'executor',
			workState: { kind: 'focused', taskId: 'task-no-commitment' },
			lastSeenAt: Date.now(),
		});
		store.setTaskBoardEntry(
			createDoingClaimTask({
				taskId: 'task-no-commitment',
				turnId: 'turn-1',
				requesterConnectionId: 'conn-requester',
				assigneeId: 'session-agent',
				assigneeName: 'Session Agent',
				assignmentToken: 'token-5',
				claimLeaseExpiresAt: 900,
				executionLeaseExpiresAt: 900,
			}),
		);

		const reaper = new ClaimLeaseReaper({
			store,
			now: () => 1_000,
			onExecutionLeaseExpired,
		});

		await reaper.scanOnce();

		expect(onExecutionLeaseExpired).toHaveBeenCalledWith({
			taskId: 'task-no-commitment',
			agentId: 'session-agent',
		});
	});
});
