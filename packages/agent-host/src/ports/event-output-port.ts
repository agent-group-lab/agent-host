import type { IAgentEventEnvelope } from '@agent-group-lab/contracts/agent';
import type { ITransitionEvent } from '@agent-group-lab/contracts/events';
import type { ITimelineEntry } from '@agent-group-lab/contracts/timeline';

export interface IEventOutputPort {
	onTransitionEvents: (events: ITransitionEvent[]) => void;
	onAgentEvent?: (payload: IAgentEventEnvelope) => void;
	onTimeline?: (entry: ITimelineEntry, sessionStartedAt: number) => void;
}

export const noopEventOutputPort: IEventOutputPort = {
	onTransitionEvents: () => {},
	onAgentEvent: () => {},
};
