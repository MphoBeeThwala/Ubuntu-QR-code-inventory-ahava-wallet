/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  coverageThreshold: {
    global: {
      lines: 95,
      functions: 90,
      branches: 80,
    },
  },
  coverageReporters: ["text", "lcov", "json-summary"],
  moduleNameMapper: {
    "^@ahava/shared-errors(.*)$": "<rootDir>/../../packages/shared-errors/src/index.ts",
    "^@ahava/shared-crypto(.*)$": "<rootDir>/../../packages/shared-crypto/src/index.ts",
    "^@ahava/shared-events(.*)$": "<rootDir>/../../packages/shared-events/src/index.ts",
    "^@ahava/shared-types(.*)$": "<rootDir>/../../packages/shared-types/src/index.ts",
  },
  // Only collect coverage from main.ts — the other src files (payshap, queues, etc.)
  // are scaffolded but not wired into the current entry-point and have their own
  // external dependencies that are not mocked in this test suite.
  collectCoverageFrom: [
    "src/main.ts",
  ],
  testTimeout: 15000,
};
