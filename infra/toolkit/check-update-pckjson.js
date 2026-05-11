const { readPackages, formatVersion } = require('./utils');
const path = require('node:path');
const fs = require('node:fs');

const rootPath = path.resolve(__dirname, '../../');

function checkUpdatePckJson(param) {
	const { isWrite } = param;
	const ncuJson = require(path.resolve(rootPath, 'ncu.json'));
	const packages = readPackages();
	const newPackageJsons = [];
	const ncuError = [];

	Object.entries(ncuJson.devDependencies).forEach(([name, value]) => {
		if (ncuJson.dependencies[name]) {
			const depValue = formatVersion(ncuJson.dependencies[name]);
			const devValue = formatVersion(value);
			if (
				depValue.length === 0 &&
				devValue.length === 0 &&
				depValue[0].version !== devValue[0].version
			) {
				ncuError.push({
					name,
					path: 'ncu.json',
					type: `ncu devDependencies[${name}]@${value} !== dependencies[${name}]@${ncuJson.dependencies[name]}`,
				});
			}
		}
	});

	Object.values(packages).forEach((pck) => {
		const pckJson = require(path.resolve(pck.path, 'package.json'));
		const newPackageJson = { ...pckJson };
		if (pckJson.devDependencies) {
			Object.entries(pckJson.devDependencies).forEach(([name]) => {
				if (ncuJson.devDependencies[name] === undefined) {
					ncuError.push({
						name,
						path: `${pck.path}/package.json`,
						type: 'devDependencies',
					});
				} else {
					const ncuValue = formatVersion(ncuJson.devDependencies[name]);
					const curVersion = newPackageJson.devDependencies[name];
					const isLocked = ncuValue.some(
						(item) => item.locked === true && item.version === curVersion,
					);
					const newVersion = ncuValue.find(
						(item) => item.locked === false && item.version !== curVersion,
					);
					if (!isLocked && newVersion) {
						newPackageJson.devDependencies[name] = newVersion.version;
					}
				}
			});
		}
		if (pckJson.dependencies) {
			Object.entries(pckJson.dependencies).forEach(([name]) => {
				if (ncuJson.dependencies[name] === undefined) {
					ncuError.push({
						name,
						path: `${pck.path}/package.json`,
						type: 'dependencies',
					});
				} else {
					const ncuValue = formatVersion(ncuJson.dependencies[name]);
					const curVersion = newPackageJson.dependencies[name];
					const isLocked = ncuValue.some(
						(item) => item.locked === true && item.version === curVersion,
					);
					const newVersion = ncuValue.find(
						(item) => item.locked === false && item.version !== curVersion,
					);
					if (!isLocked && newVersion) {
						newPackageJson.dependencies[name] = newVersion.version;
					}
				}
			});
		}
		newPackageJsons.push({
			path: pck.path,
			packageJson: newPackageJson,
		});
	});

	if (ncuError.length) {
		console.error('ncuError:');
		console.error(ncuError);
		process.exit(1);
	}

	if (isWrite) {
		newPackageJsons.forEach((item) => {
			fs.writeFileSync(
				`${item.path}/package.json`,
				`${JSON.stringify(item.packageJson, null, 2)}\n`,
			);
		});
	}
}

module.exports = checkUpdatePckJson;
