import { defineConfig } from 'vitest/config';

// `npm run sim` plays headless matches and prints balance statistics.
// It is a tuning tool, not part of the regular test suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/sim/**/*.sim.ts'],
    testTimeout: 300_000,
    // The report is printed with console.log.
    silent: false,
    printConsoleTrace: false,
  },
});
