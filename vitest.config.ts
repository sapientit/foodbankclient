import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Standalone — this deliberately does NOT extend `vite.config.ts`.
 *
 * `vite.config.ts` carries `@cloudflare/vite-plugin`, and sharing the config
 * would load it into every test run, which boots workerd and turns a 200 ms
 * unit test into a container start. The app under test is plain React talking
 * to a mocked API, and `src/worker/index.test.ts` uses structural stubs; neither
 * needs the runtime.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Explicit imports, matching the server's style.
    globals: false,
    /*
     * Vitest's default is five seconds, and the public referral form does not
     * fit in it on a loaded machine.
     *
     * Nothing there is slow in the sense of waiting: filling page one is around
     * eighty-five keystrokes and seven select changes against a form built at
     * runtime from a forty-three question config, where every answer
     * re-evaluates the conditional guards — plus the referrer-address check's
     * real four-hundred-millisecond debounce, which those tests deliberately do
     * not fake because the debounce is part of what they prove. Idle, the
     * slowest of them lands at about 1.5 seconds. Under a parallel build it
     * passes five and the run goes red for no reason anybody can act on, which
     * teaches people to re-run until green — and that is how a real failure
     * gets waved through.
     *
     * Fifteen seconds keeps roughly ten times the headroom on the slowest test
     * while still failing a genuine hang promptly. Raise the work, not this
     * number, if a test starts needing more.
     */
    testTimeout: 15_000,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    coverage: {
      // v8 is fine here: unlike the server's tests, nothing runs in workerd.
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/api/schema.d.ts', 'src/vite-env.d.ts'],
    },
  },
});
