/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json', isolatedModules: true, diagnostics: { ignoreCodes: [151002] } }],
  },
  setupFiles: ['<rootDir>/__tests__/setup-env.ts'],
};
