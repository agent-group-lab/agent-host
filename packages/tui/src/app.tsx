import type { ISessionAgent, SessionStore } from '@agent-group-lab/session';
import { SessionScreenContent } from '@agent-group-lab/session';
import { Box } from 'ink';

type IProps = { store: SessionStore<ISessionAgent> };

export const App = function App({ store }: IProps) {
	return (
		<Box flexDirection='column'>
			<SessionScreenContent
				onCancel={store.cancel}
				onSubmit={store.sendPrompt}
				store={store}
			/>
		</Box>
	);
};
