import type {
	ITaskPlanNodePayload,
	ITaskPublishBatchResultPayload,
} from '@agent-group-lab/contracts/messages';
import { describe, expect, it, vi } from 'vitest';
import {
	buildGetPeersTool,
	buildGetTasksByIdsTool,
	buildPublishClaimableTasksTool,
	buildWaitForChildrenTool,
} from './tool-builder';

describe('tool-builder', () => {
	it('defaults publish_claimable_tasks nodes to current parent task and claim mode', async () => {
		const publishBatchAndWait = vi.fn(
			async (input: {
				planId?: string;
				nodes: ITaskPlanNodePayload[];
				atomic?: boolean;
			}) =>
				({
					planId: input.planId ?? 'plan-1',
					status: 'accepted',
					acceptedTaskIds: ['child-1', 'child-2'],
				}) satisfies ITaskPublishBatchResultPayload,
		);
		const tool = buildPublishClaimableTasksTool({
			publishBatchAndWait,
			resolveCurrentTaskId: () => 'parent-1',
		});

		await tool.handler({
			nodes: [
				{
					taskId: 'child-1',
					turnId: 'turn-1',
					prompt: '1+2',
					workingDirectory: '/tmp',
				},
				{
					taskId: 'child-2',
					turnId: 'turn-2',
					prompt: '3+4',
					workingDirectory: '/tmp',
					parentTaskId: 'explicit-parent',
					dispatchMode: 'push',
				},
			],
		});

		expect(publishBatchAndWait).toHaveBeenCalledTimes(1);
		expect(publishBatchAndWait).toHaveBeenCalledWith({
			nodes: [
				{
					taskId: 'child-1',
					turnId: 'turn-1',
					prompt: '1+2',
					workingDirectory: '/tmp',
					parentTaskId: 'parent-1',
					dispatchMode: 'claim',
				},
				{
					taskId: 'child-2',
					turnId: 'turn-2',
					prompt: '3+4',
					workingDirectory: '/tmp',
					parentTaskId: 'explicit-parent',
					dispatchMode: 'push',
				},
			],
			planId: undefined,
			atomic: undefined,
		});
	});

	it('defaults wait_for_children parentTaskId to current task', async () => {
		const waitForChildrenAndWait = vi.fn(async () => ({
			status: 'completed',
			parentTaskId: 'parent-1',
		}));
		const tool = buildWaitForChildrenTool({
			waitForChildrenAndWait,
			resolveCurrentTaskId: () => 'parent-1',
		});

		await tool.handler({});

		expect(waitForChildrenAndWait).toHaveBeenCalledTimes(1);
		expect(waitForChildrenAndWait).toHaveBeenCalledWith({
			parentTaskId: 'parent-1',
			failFast: true,
			timeoutMs: undefined,
		});
	});

	it('prefers current task over mismatched wait_for_children parentTaskId input', async () => {
		const waitForChildrenAndWait = vi.fn(async () => ({
			status: 'completed',
			parentTaskId: 'parent-1',
		}));
		const tool = buildWaitForChildrenTool({
			waitForChildrenAndWait,
			resolveCurrentTaskId: () => 'parent-1',
		});

		await tool.handler({
			parentTaskId: 'child-1',
		});

		expect(waitForChildrenAndWait).toHaveBeenCalledWith({
			parentTaskId: 'parent-1',
			failFast: true,
			timeoutMs: undefined,
		});
	});

	it('uses explicit parentTaskId when no active source task exists', async () => {
		const waitForChildrenAndWait = vi.fn(async () => ({
			status: 'completed',
			parentTaskId: 'parent-explicit',
		}));
		const tool = buildWaitForChildrenTool({
			waitForChildrenAndWait,
			resolveCurrentTaskId: () => undefined,
		});

		await tool.handler({
			parentTaskId: 'parent-explicit',
		});

		expect(waitForChildrenAndWait).toHaveBeenCalledWith({
			parentTaskId: 'parent-explicit',
			failFast: true,
			timeoutMs: undefined,
		});
	});

	it('throws when wait_for_children has no parent and no active task', async () => {
		const tool = buildWaitForChildrenTool({
			waitForChildrenAndWait: vi.fn(async () => ({ status: 'completed' })),
			resolveCurrentTaskId: () => undefined,
		});

		await expect(tool.handler({})).rejects.toThrow(
			'wait_for_children requires parentTaskId or an active source task',
		);
	});

	it('returns selected tasks for get_tasks_by_ids', async () => {
		const getTaskStatusAndWait = vi.fn(async () => ({
			requestId: 'req-1',
			tasks: [
				{
					taskId: 'child-1',
					status: 'done' as const,
					artifact: { content: 'a' },
				},
				{
					taskId: 'child-2',
					status: 'cancelled' as const,
					failureMessage: 'failed',
				},
			],
			missingTaskIds: ['child-3'],
		}));
		const tool = buildGetTasksByIdsTool({
			getTaskStatusAndWait,
		});

		const result = await tool.handler({
			taskIds: ['child-2', 'child-1', 'child-3'],
		});

		expect(getTaskStatusAndWait).toHaveBeenCalledWith({
			taskIds: ['child-2', 'child-1', 'child-3'],
			includeArtifacts: true,
		});
		expect(result).toEqual({
			tasks: [
				{
					taskId: 'child-2',
					status: 'cancelled',
					failureMessage: 'failed',
				},
				{
					taskId: 'child-1',
					status: 'done',
					artifact: { content: 'a' },
				},
			],
			missingTaskIds: ['child-3'],
		});
	});

	it('forwards includeArtifacts for get_tasks_by_ids', async () => {
		const getTaskStatusAndWait = vi.fn(async () => ({
			requestId: 'req-1',
			tasks: [],
			missingTaskIds: ['child-1'],
		}));
		const tool = buildGetTasksByIdsTool({
			getTaskStatusAndWait,
		});

		await tool.handler({ taskIds: ['child-1'], includeArtifacts: false });

		expect(getTaskStatusAndWait).toHaveBeenCalledWith({
			taskIds: ['child-1'],
			includeArtifacts: false,
		});
	});

	it('returns current peers for get_peers', async () => {
		const getPeers = vi.fn(async () => [
			{
				agentId: 'exec-1',
				agentName: 'exec-1',
				adapterId: 'codex',
				agentRole: 'executor' as const,
				workState: { kind: 'idle' as const },
				lastSeenAt: 1,
				workerProfile: {
					tags: ['math'],
					profile: 'fast calculator',
				},
			},
			{
				agentId: 'review-1',
				agentName: 'review-1',
				adapterId: 'claude',
				agentRole: 'reviewer' as const,
				workState: { kind: 'focused' as const, taskId: 'task-1' },
				lastSeenAt: 2,
			},
		]);
		const tool = buildGetPeersTool({ getPeers });

		const result = await tool.handler({});

		expect(getPeers).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			peers: [
				{
					agentId: 'exec-1',
					agentName: 'exec-1',
					role: 'executor',
					delegate: 'yes',
					adapter: 'codex',
					status: 'idle',
					tags: ['math'],
					profile: 'fast calculator',
				},
				{
					agentId: 'review-1',
					agentName: 'review-1',
					role: 'reviewer',
					delegate: 'no',
					adapter: 'claude',
					status: 'focused',
					tags: [],
					profile: '',
				},
			],
		});
	});
});
