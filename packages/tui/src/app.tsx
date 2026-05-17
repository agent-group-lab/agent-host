import type { ISessionAgent, SessionStore } from '@agent-group-lab/session';
import { SessionScreenContent } from '@agent-group-lab/session';
import { Box } from 'ink';

type IProps = {
	store: SessionStore<ISessionAgent>;
	onExit: () => void | Promise<void>;
};

export const App = function App({ onExit, store }: IProps) {
	return (
		<Box flexDirection='column'>
			<SessionScreenContent
				onCancel={store.cancel}
				onExit={onExit}
				onSubmit={store.sendPrompt}
				store={store}
			/>
		</Box>
	);
};
