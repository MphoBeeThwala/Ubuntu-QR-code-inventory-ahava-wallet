/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/main.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json-summary"],
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  moduleNameMapper: {
    "^@ahava/(.*)$": "<rootDir>/../packages/$1/src"
  },
  testTimeout: 10000
};
