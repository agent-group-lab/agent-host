import type { IToolDefinition } from '@agent-group-lab/contracts/agent';
import type {
	IDirectResponsePayload,
	ITaskListResultPayload,
	ITaskPlanNodePayload,
	ITaskPublishBatchResultPayload,
	IWorkerSummary,
} from '@agent-group-lab/contracts/messages';
import type { IDelegateTaskInput } from './delegation-manager';

export const askPeerToolSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		toAgentId: {
			type: 'string',
			description: 'Target agent ID to consult',
		},
		toAgentName: {
			type: 'string',
			description: 'Target agent name (obtain from get_peers)',
		},
		question: {
			type: 'string',
			description: 'Question to ask the target peer',
		},
		timeoutMs: {
			type: 'number',
			description: 'Optional timeout in milliseconds (default 60000)',
		},
		reason: {
			type: 'string',
			description: 'Optional rationale for why this peer is being asked',
		},
	},
	required: ['toAgentId', 'toAgentName', 'question'],
};

export const delegateTaskToolSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		toAgentId: {
			type: 'string',
			description: 'Target executor worker ID',
		},
		toAgentName: {
			type: 'string',
			description: 'Target executor worker name (obtain from get_peers)',
		},
		prompt: {
			type: 'string',
			description: 'Sub-task prompt to execute',
		},
		deliverableSpec: {
			type: 'string',
			description: 'Optional deliverable specification',
		},
		taskId: {
			type: 'string',
			description: 'Optional explicit task id for traceability',
		},
		timeoutMs: {
			type: 'number',
			description: 'Optional timeout in milliseconds (default 180000)',
		},
	},
	required: ['toAgentId', 'toAgentName', 'prompt'],
};

export const publishClaimableTasksToolSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		nodes: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					taskId: {
						type: 'string',
						description: 'Unique task id',
					},
					turnId: {
						type: 'string',
						description: 'Turn id correlated with this task',
					},
					prompt: {
						type: 'string',
						description: 'Task prompt',
					},
					workingDirectory: {
						type: 'string',
						description: 'Working directory path',
					},
					parentTaskId: {
						type: 'string',
						description: 'Optional parent task id',
					},
					dependencies: {
						type: 'array',
						items: {
							type: 'string',
						},
						description: 'Optional dependency task ids',
					},
					deliverableSpec: {
						type: 'string',
						description: 'Optional deliverable contract',
					},
					slaDeadline: {
						type: 'number',
						description: 'Optional SLA deadline in epoch milliseconds',
					},
					dispatchMode: {
						type: 'string',
						enum: ['push', 'claim'],
						description: 'Dispatch mode for this node',
					},
					requestedAgentId: {
						type: 'string',
						description: 'Optional requested agent id for push dispatch',
					},
					suggestedAgentIds: {
						type: 'array',
						items: {
							type: 'string',
						},
						description: 'Optional preferred/suggested executor ids for claim',
					},
					suggestionPolicy: {
						type: 'string',
						enum: ['strict', 'preferred'],
						description: 'Claim suggestion policy',
					},
				},
				required: ['taskId', 'turnId', 'prompt', 'workingDirectory'],
			},
			description: 'Task plan nodes for claim-based dispatch',
		},
		planId: {
			type: 'string',
			description: 'Optional plan id for traceability',
		},
		atomic: {
			type: 'boolean',
			description: 'Whether to publish atomically (default true)',
		},
	},
	required: ['nodes'],
};

export const waitForChildrenToolSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		parentTaskId: {
			type: 'string',
			description: 'Parent task id to wait for',
		},
		failFast: {
			type: 'boolean',
			description: 'Fail immediately when any child fails (default true)',
		},
		timeoutMs: {
			type: 'number',
			description: 'Optional wait timeout in milliseconds',
		},
	},
};

interface IBuildAskPeerToolOptions {
	sendDirectRequestAndWait: (input: {
		toAgentId: string;
		toAgentName: string;
		prompt: string;
		timeoutMs?: number;
		intent?: string;
	}) => Promise<IDirectResponsePayload>;
}

interface IBuildDelegateTaskToolOptions {
	sendDelegatedTaskAndWait: (input: IDelegateTaskInput) => Promise<unknown>;
}

interface IBuildPublishClaimableTasksToolOptions {
	publishBatchAndWait: (input: {
		planId?: string;
		nodes: ITaskPlanNodePayload[];
		atomic?: boolean;
	}) => Promise<ITaskPublishBatchResultPayload>;
	resolveCurrentTaskId: () => string | undefined;
}

interface IBuildWaitForChildrenToolOptions {
	waitForChildrenAndWait: (input: {
		parentTaskId: string;
		failFast?: boolean;
		timeoutMs?: number;
	}) => Promise<unknown>;
	resolveCurrentTaskId: () => string | undefined;
}

export const getTasksByIdsToolSchema: Record<string, unknown> = {
	type: 'object',
	properties: {
		taskIds: {
			type: 'array',
			items: {
				type: 'string',
			},
			description: 'Task ids to query',
		},
		includeArtifacts: {
			type: 'boolean',
			description: 'Whether to include task artifacts (default true)',
		},
	},
	required: ['taskIds'],
};

interface IBuildGetTasksByIdsToolOptions {
	getTaskStatusAndWait: (input: {
		taskIds: string[];
		includeArtifacts: boolean;
	}) => Promise<ITaskListResultPayload>;
}

interface IBuildGetPeersToolOptions {
	getPeers: () => Promise<IWorkerSummary[]>;
}

export const buildAskPeerTool = (
	options: IBuildAskPeerToolOptions,
): IToolDefinition => {
	return {
		name: 'ask_peer',
		description:
			'Send a question or message directly to a specific peer agent and wait for their response. ' +
			'Use when you need to consult, collaborate with, or get a reply from another agent. ' +
			'You are responsible for driving the conversation to completion — do NOT hand partial results back to the user mid-exchange. ' +
			'After each response, actively decide: is this enough to fully answer the user, or do I need to push further? ' +
			'Keep calling ask_peer until you have everything needed. Only then produce your final output. ' +
			'Requires toAgentId and toAgentName — call get_peers first if you do not already have them.',
		inputSchema: askPeerToolSchema,
		handler: async (input) => {
			const toAgentId =
				typeof input.toAgentId === 'string' ? input.toAgentId.trim() : '';
			const toAgentName =
				typeof input.toAgentName === 'string' ? input.toAgentName.trim() : '';
			const question =
				typeof input.question === 'string' ? input.question.trim() : '';
			if (!toAgentId) {
				throw new Error('ask_peer requires a non-empty toAgentId');
			}
			if (!toAgentName) {
				throw new Error('ask_peer requires a non-empty toAgentName');
			}
			if (!question) {
				throw new Error('ask_peer requires a non-empty question');
			}

			const timeoutMs =
				typeof input.timeoutMs === 'number' &&
				Number.isFinite(input.timeoutMs) &&
				input.timeoutMs > 0
					? input.timeoutMs
					: undefined;
			const reason =
				typeof input.reason === 'string' && input.reason.trim().length > 0
					? input.reason.trim()
					: undefined;

			const response = await options.sendDirectRequestAndWait({
				toAgentId,
				toAgentName,
				prompt: question,
				timeoutMs,
				intent: reason,
			});
			return {
				status: response.action,
				fromAgentId: response.fromAgentId,
				fromAgentName: response.fromAgentName,
				toAgentId: response.toAgentId,
				toAgentName: response.toAgentName,
				content: response.content,
				origin: response.origin,
				ackKind: response.ackKind,
				reasonCode: response.reasonCode,
				reason: response.reason,
			};
		},
	};
};

export const buildDelegateTaskTool = (
	options: IBuildDelegateTaskToolOptions,
): IToolDefinition => {
	return {
		name: 'delegate_task',
		description:
			'Assign a sub-task to a specific peer agent and wait for the result. ' +
			'Use when you want to offload a well-defined unit of work to another agent. ' +
			'Requires toAgentId and toAgentName — call get_peers first if you do not already have them.',
		inputSchema: delegateTaskToolSchema,
		handler: async (input) => {
			const toAgentId =
				typeof input.toAgentId === 'string' ? input.toAgentId.trim() : '';
			const toAgentName =
				typeof input.toAgentName === 'string' ? input.toAgentName.trim() : '';
			const prompt =
				typeof input.prompt === 'string' ? input.prompt.trim() : '';
			if (!toAgentId) {
				throw new Error('delegate_task requires a non-empty toAgentId');
			}
			if (!toAgentName) {
				throw new Error('delegate_task requires a non-empty toAgentName');
			}
			if (!prompt) {
				throw new Error('delegate_task requires a non-empty prompt');
			}
			const timeoutMs =
				typeof input.timeoutMs === 'number' &&
				Number.isFinite(input.timeoutMs) &&
				input.timeoutMs > 0
					? input.timeoutMs
					: undefined;
			const deliverableSpec =
				typeof input.deliverableSpec === 'string' &&
				input.deliverableSpec.trim().length > 0
					? input.deliverableSpec.trim()
					: undefined;
			const taskId =
				typeof input.taskId === 'string' && input.taskId.trim().length > 0
					? input.taskId.trim()
					: undefined;

			return await options.sendDelegatedTaskAndWait({
				toAgentId,
				toAgentName,
				prompt,
				deliverableSpec,
				taskId,
				timeoutMs,
			});
		},
	};
};

export const buildPublishClaimableTasksTool = (
	options: IBuildPublishClaimableTasksToolOptions,
): IToolDefinition => {
	return {
		name: 'publish_claimable_tasks',
		description:
			'Publish a batch of tasks as a DAG for executor agents to claim and execute in parallel. ' +
			'Use when you need to fan out multiple independent or dependent sub-tasks across the agent pool. ' +
			'Follow with wait_for_children to collect results.',
		inputSchema: publishClaimableTasksToolSchema,
		handler: async (input) => {
			if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
				throw new Error('publish_claimable_tasks requires non-empty nodes');
			}
			const currentTaskId = options.resolveCurrentTaskId();
			const nodes = (input.nodes as ITaskPlanNodePayload[]).map((node) => ({
				...node,
				dispatchMode: node.dispatchMode ?? 'claim',
				parentTaskId: node.parentTaskId ?? currentTaskId,
			}));
			const planId =
				typeof input.planId === 'string' && input.planId.trim().length > 0
					? input.planId.trim()
					: undefined;
			const atomic =
				typeof input.atomic === 'boolean' ? input.atomic : undefined;
			return await options.publishBatchAndWait({
				nodes,
				planId,
				atomic,
			});
		},
	};
};

export const buildWaitForChildrenTool = (
	options: IBuildWaitForChildrenToolOptions,
): IToolDefinition => {
	return {
		name: 'wait_for_children',
		description:
			'Block until all child tasks published via publish_claimable_tasks have completed. ' +
			'Call this after publish_claimable_tasks to synchronize on results before producing your final output.',
		inputSchema: waitForChildrenToolSchema,
		handler: async (input) => {
			const currentTaskId = options.resolveCurrentTaskId();
			const parentTaskIdFromInput =
				typeof input.parentTaskId === 'string' ? input.parentTaskId.trim() : '';
			const parentTaskId = currentTaskId || parentTaskIdFromInput;
			if (!parentTaskId) {
				throw new Error(
					'wait_for_children requires parentTaskId or an active source task',
				);
			}
			const failFast =
				typeof input.failFast === 'boolean' ? input.failFast : true;
			const timeoutMs =
				typeof input.timeoutMs === 'number' &&
				Number.isFinite(input.timeoutMs) &&
				input.timeoutMs > 0
					? input.timeoutMs
					: undefined;
			return await options.waitForChildrenAndWait({
				parentTaskId,
				failFast,
				timeoutMs,
			});
		},
	};
};

export const buildGetTasksByIdsTool = (
	options: IBuildGetTasksByIdsToolOptions,
): IToolDefinition => {
	return {
		name: 'get_tasks_by_ids',
		description:
			'Fetch the status and output artifacts of tasks by their IDs. ' +
			'Use after wait_for_children, or anytime you need to read the result of a previously published task.',
		inputSchema: getTasksByIdsToolSchema,
		handler: async (input) => {
			if (!Array.isArray(input.taskIds) || input.taskIds.length === 0) {
				throw new Error('get_tasks_by_ids requires non-empty taskIds');
			}
			const taskIds = [
				...new Set(
					(input.taskIds as unknown[])
						.map((value) => (typeof value === 'string' ? value.trim() : ''))
						.filter((value) => value.length > 0),
				),
			];
			if (taskIds.length === 0) {
				throw new Error('get_tasks_by_ids requires non-empty taskIds');
			}
			const includeArtifacts =
				typeof input.includeArtifacts === 'boolean'
					? input.includeArtifacts
					: true;
			const status = await options.getTaskStatusAndWait({
				taskIds,
				includeArtifacts,
			});
			const byTaskId = new Map(
				status.tasks.map((task) => [task.taskId, task] as const),
			);
			const tasks = taskIds
				.map((taskId) => byTaskId.get(taskId))
				.filter((task): task is NonNullable<typeof task> => task !== undefined);
			const missingTaskIds = taskIds.filter((taskId) => !byTaskId.has(taskId));
			return {
				tasks,
				missingTaskIds,
			};
		},
	};
};

export const buildGetPeersTool = (
	options: IBuildGetPeersToolOptions,
): IToolDefinition => {
	return {
		name: 'get_peers',
		description:
			'List currently available peer agents. ' +
			'Call this first whenever you need to communicate with, delegate to, or collaborate with another agent. ' +
			'Returns agentId and agentName required by ask_peer and delegate_task.',
		inputSchema: {
			type: 'object',
			properties: {},
		},
		handler: async () => {
			const peers = await options.getPeers();
			return {
				peers: peers.map((peer) => ({
					agentId: peer.agentId,
					agentName: peer.agentName,
					role: peer.agentRole,
					delegate: peer.agentRole === 'reviewer' ? 'no' : 'yes',
					adapter: peer.adapterId,
					status: peer.workState.kind,
					tags: peer.workerProfile?.tags ?? [],
					profile: peer.workerProfile?.profile ?? '',
				})),
			};
		},
	};
};
