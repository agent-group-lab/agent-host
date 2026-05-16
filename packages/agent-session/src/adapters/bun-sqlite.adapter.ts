import type { Database } from 'bun:sqlite';
import {
	eventLogEntrySchema,
	type IEventLogEntry,
} from '~/contracts/event-log.contract';
import type { IHistoryService } from '~/contracts/history.contract';

const MAX_HISTORY_ENTRIES = 300;

class EventLogRow {
	data!: string;
}

export class BunSQLiteHistoryAdapter implements IHistoryService {
	constructor(private readonly _db: Database) {
		this._init();
	}

	private _init() {
		this._db.exec(`
      CREATE TABLE IF NOT EXISTS session_event_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT    NOT NULL,
        data       TEXT    NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_session_event_log_session_id
        ON session_event_log (session_id, id);
    `);
	}

	async loadHistory(sessionId: string): Promise<IEventLogEntry[]> {
		const rows = this._db
			.query<EventLogRow, { sessionId: string; limit: number }>(
				'SELECT data FROM session_event_log WHERE session_id = $sessionId ORDER BY id ASC LIMIT $limit',
			)
			.as(EventLogRow)
			.all({ sessionId, limit: MAX_HISTORY_ENTRIES });

		return rows.flatMap((row) => {
			try {
				const parsed = eventLogEntrySchema.safeParse(JSON.parse(row.data));
				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});
	}

	async appendEvent(sessionId: string, entry: IEventLogEntry): Promise<void> {
		this._db.transaction(() => {
			this._db
				.query(
					'INSERT INTO session_event_log (session_id, data) VALUES ($sessionId, $data)',
				)
				.run({ sessionId, data: JSON.stringify(entry) });

			const { total } = this._db
				.query<{ total: number }, { sessionId: string }>(
					'SELECT COUNT(*) AS total FROM session_event_log WHERE session_id = $sessionId',
				)
				.get({ sessionId }) as { total: number };

			if (total > MAX_HISTORY_ENTRIES) {
				this._db
					.query(
						`DELETE FROM session_event_log
             WHERE session_id = $sessionId
               AND id IN (
                 SELECT id FROM session_event_log
                 WHERE session_id = $sessionId
                 ORDER BY id ASC LIMIT $excess
               )`,
					)
					.run({ sessionId, excess: total - MAX_HISTORY_ENTRIES });
			}
		})();
	}
}
