// Monorepo-aware Metro config. Without this Metro can't resolve workspace
// packages or hoisted deps in the root node_modules. See:
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// pnpm hoists, but workspace packages live outside node_modules. Disabling
// hierarchical lookup forces Metro to use the explicit nodeModulesPaths above.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
