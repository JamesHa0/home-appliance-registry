/**
 * Jest 测试配置
 * Run tests with: npx jest
 */

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'utils/**/*.js',
    '!utils/cloud.js' // Skip cloud wrapper (uses wx mini-program context)
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.snap$',
    'e2e'
  ],
  verbose: true,
  transform: {},
  moduleFileExtensions: ['js'],
  testTimeout: 10000,
  testSequencer: '<rootDir>/tests/sequencer.js' // Sequential execution for integration tests
}
