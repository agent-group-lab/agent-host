const reactDomShim = {
	name: 'react-dom-shim',
	setup(build: Bun.PluginBuilder) {
		build.onResolve({ filter: /^react-dom$/ }, () => ({
			namespace: 'react-dom-shim',
			path: 'react-dom',
		}));

		build.onLoad({ filter: /.*/, namespace: 'react-dom-shim' }, () => ({
			contents:
				'export const unstable_batchedUpdates = (callback, ...args) => callback(...args);',
			loader: 'js',
		}));
	},
} satisfies Bun.BunPlugin;

const result = await Bun.build({
	compile: { outfile: './dist/tui' },
	entrypoints: ['./src/index.ts'],
	plugins: [reactDomShim],
	target: 'bun',
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

export {};
