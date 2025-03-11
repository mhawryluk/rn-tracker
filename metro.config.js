const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

// Find the project and workspace directories
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  "/Users/marcinhawryluk/Documents/wigsill/packages/unplugin-typegpu/dist",
];

module.exports = config;
