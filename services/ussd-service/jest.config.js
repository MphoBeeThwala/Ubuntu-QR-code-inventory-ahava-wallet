/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/main.ts"],
  coverageThreshold: {
    global: { lines: 75, functions: 75, branches: 65 },
  },
  coverageReporters: ["text", "lcov", "json-summary"],
  moduleNameMapper: {
    "^@ahava/shared-errors(.*)$": "<rootDir>/../../packages/shared-errors/src/index.ts",
    "^@ahava/shared-events(.*)$": "<rootDir>/../../packages/shared-events/src/index.ts",
  },
  testTimeout: 15000,
};
