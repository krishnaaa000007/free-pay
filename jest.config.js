/** Jest config for the mobile package. Tests target pure domain/service logic (no native modules). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^react-native$': '<rootDir>/__tests__/__mocks__/react-native.js',
    // Jest runs in Node: use the web (no-op) SQLite driver so expo-sqlite is never loaded.
    '^(.*)/sqliteDriver$': '$1/sqliteDriver.web',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }],
  },
  modulePathIgnorePatterns: ['<rootDir>/server', '<rootDir>/admin'],
};
