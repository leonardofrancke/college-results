const path = require('path');

module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  testEnvironment: 'node',
  testTimeout: 15000,
  verbose: true,
  coverageProvider: 'v8',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/e2e/**/*.test.js',
  ],
  modulePaths: [
    '<rootDir>/api/node_modules',
    '<rootDir>/tests/node_modules',
  ],
  collectCoverageFrom: [
    'api/server.js',
  ],
  coverageDirectory: '<rootDir>/tests/coverage',
};
