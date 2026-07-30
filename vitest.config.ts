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
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    coverage: {
      // v8 is fine here: unlike the server's tests, nothing runs in workerd.
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/api/schema.d.ts', 'src/vite-env.d.ts'],
    },
  },
});
