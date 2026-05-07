// Monorepo-aware Metro config. Stick close to Expo's defaults — the only
// override is the watchFolders extension to include the workspace root so
// Metro re-bundles when shared workspace files change. Hierarchical lookup
// is left enabled so Metro can find transitive deps via the standard
// `node_modules/.../node_modules` walk; the public-hoist-pattern in the
// root `.npmrc` keeps RN/Expo deps reachable.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
