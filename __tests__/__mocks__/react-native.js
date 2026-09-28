/** Minimal react-native stub for pure-logic tests (no native runtime in Jest node env). */
module.exports = {
  Platform: { OS: 'test', select: (o) => (o && 'default' in o ? o.default : o?.ios) },
};
