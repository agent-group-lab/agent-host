const fs = require('node:fs');
const path = require('node:path');

const { getLatestVersion } = require('./utils');

const rootPath = path.resolve(__dirname, '../../');

async function autoUpdateNcu() {
	const ncuJson = JSON.parse(
		fs.readFileSync(path.join(rootPath, 'ncu.json'), 'utf8'),
	);
	const pcks = Array.from(
		new Set([
			...Object.entries(ncuJson.dependencies)
				.filter(([_, version]) => version !== 'workspace:*')
				.map((name) => name),
			...Object.entries(ncuJson.devDependencies)
				.filter(([_, version]) => version !== 'workspace:*')
				.map((name) => name),
		]),
	);

	const versions = await Promise.all(
		pcks.map(([name]) => getLatestVersion(name)),
	);
	const updateDependency = (dep, name, version) => {
		if (!dep[name]) return;

		if (typeof dep[name] === 'string') {
			dep[name] = version;
		} else if (Array.isArray(dep[name])) {
			dep[name].forEach((item, index) => {
				if (typeof item === 'string') {
					dep[name][index] = version;
				} else if (!item?.locked) {
					item.version = version;
				}
			});
		} else if (!dep[name].locked) {
			dep[name].version = version;
		}
	};

	pcks.forEach(([name], idx) => {
		const version = versions[idx];
		if (version) {
			updateDependency(ncuJson.dependencies, name, version);
			updateDependency(ncuJson.devDependencies, name, version);
		}
	});

	fs.writeFileSync(
		path.join(rootPath, 'ncu.json'),
		`${JSON.stringify(ncuJson, null, 2)}\n`,
	);
}

module.exports = autoUpdateNcu;
