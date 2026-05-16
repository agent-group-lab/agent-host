import type { IEventLogEntry } from './event-log.contract';

export interface IHistoryService {
	loadHistory(sessionId: string): Promise<IEventLogEntry[]>;
	appendEvent(sessionId: string, entry: IEventLogEntry): Promise<void>;
}
