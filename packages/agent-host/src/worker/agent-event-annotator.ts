import type { AgentEvent } from '@agent-group-lab/contracts/agent';

const toStringArray = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [] as string[];
	}
	return value.filter((item): item is string => typeof item === 'string');
};

const toTaskIdsFromNodes = (value: unknown) => {
	if (!Array.isArray(value)) {
		return [] as string[];
	}
	const taskIds: string[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null) {
			continue;
		}
		const maybeTaskId = (item as { taskId?: unknown }).taskId;
		if (typeof maybeTaskId === 'string') {
			taskIds.push(maybeTaskId);
		}
	}
	return taskIds;
};

export const annotateToolStartEvent = (event: AgentEvent): AgentEvent => {
	if (event.type !== 'tool:start') {
		return event;
	}

	const baseName = event.toolName.replace(/^swarm-tools\//, '');
	switch (baseName) {
		case 'ask_peer': {
			const toAgentId = event.args.toAgentId;
			return {
				...event,
				targetAgentIds: typeof toAgentId === 'string' ? [toAgentId] : undefined,
			};
		}
		case 'delegate_task': {
			const toAgentId = event.args.toAgentId;
			const taskId = event.args.taskId;
			return {
				...event,
				targetAgentIds: typeof toAgentId === 'string' ? [toAgentId] : undefined,
				relatedTaskIds: typeof taskId === 'string' ? [taskId] : undefined,
			};
		}
		case 'publish_claimable_tasks': {
			const relatedTaskIds = toTaskIdsFromNodes(event.args.nodes);
			return {
				...event,
				relatedTaskIds: relatedTaskIds.length > 0 ? relatedTaskIds : undefined,
			};
		}
		case 'wait_for_children': {
			const parentTaskId = event.args.parentTaskId;
			return {
				...event,
				relatedTaskIds:
					typeof parentTaskId === 'string' ? [parentTaskId] : undefined,
			};
		}
		case 'get_tasks_by_ids': {
			const relatedTaskIds = toStringArray(event.args.taskIds);
			return {
				...event,
				relatedTaskIds: relatedTaskIds.length > 0 ? relatedTaskIds : undefined,
			};
		}
		default:
			return event;
	}
};
