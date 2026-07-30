import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    /*
     * `localhost`, never `127.0.0.1`.
     *
     * They are different hosts. The API's refresh cookie is `SameSite=Strict`,
     * so if the browser reaches the app on one and the API on the other, the
     * cookie is never sent and every user is signed out fifteen minutes after
     * logging in. See CLAUDE.md, "Deploy as one origin, not two".
     *
     * `strictPort` because a silent fallback to 5174 changes the origin
     * mid-debugging session — precisely the confusion this exists to prevent.
     */
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
});
