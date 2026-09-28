// Metro configuration for the Free Pay mobile app.
// The /server and /admin packages live in the same repository but are NOT part of the
// mobile bundle; we exclude them so Metro never crawls their node_modules.
//
// `.expo/dev/logs` is excluded for a different reason: Metro writes its own bundle log
// there. Left in the watched tree, that write invalidates the file map, which triggers a
// rebundle, which writes another log line — a loop that pins the CPU, makes every request
// crawl and eventually exhausts the heap.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Escape a filesystem path for use inside a RegExp (handles Windows backslashes).
function escapeForRegex(p) {
  return p
    .split('')
    .map((ch) => ('\\^$.|?*+()[]{}'.includes(ch) ? '\\' + ch : ch))
    .join('');
}

const blocked = ['server', 'admin'].map((dir) => new RegExp('^' + escapeForRegex(path.resolve(projectRoot, dir)) + '[\\\\/].*$'));

// Metro's shipped patterns match paths relative to the project root (e.g.
// `^android[\\/]app[\\/]build$`), so this one is left unanchored to catch either form.
blocked.push(/\.expo[\\/]dev[\\/]logs[\\/]/);

config.resolver.blockList = Array.isArray(config.resolver.blockList) ? [...config.resolver.blockList, ...blocked] : blocked;

module.exports = config;
