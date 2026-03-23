/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Only collect from main.ts; other src files (auth.service.ts, queues, etc.)
  // have external deps not mocked in this suite.
  collectCoverageFrom: ["src/main.ts"],
  coverageThresholds: {
    global: {
      lines: 93,      // main.ts is ~94.9%; gap is untestable startup app.listen block
      functions: 85,  // startup callback is uncoverable in unit tests
      branches: 90,
    },
  },
  coverageReporters: ["text", "lcov", "json-summary"],
  moduleNameMapper: {
    "^@ahava/shared-errors(.*)$": "<rootDir>/../../packages/shared-errors/src/index.ts",
    "^@ahava/shared-crypto(.*)$": "<rootDir>/../../packages/shared-crypto/src/index.ts",
    "^@ahava/shared-events(.*)$": "<rootDir>/../../packages/shared-events/src/index.ts",
    "^@ahava/shared-types(.*)$": "<rootDir>/../../packages/shared-types/src/index.ts",
  },
  testTimeout: 15000,
};
