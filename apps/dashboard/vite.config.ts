import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Load env from the workspace root (../../.env) so we can read DASHBOARD_PORT
// + MASTER_PORT shared with the rest of the project.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');
  const dashboardPort = Number(env.DASHBOARD_PORT ?? 5173);
  const masterPort = Number(env.MASTER_PORT ?? 7000);
  return {
    plugins: [react()],
    server: {
      port: dashboardPort,
      strictPort: false,
      host: '127.0.0.1',
    },
    define: {
      // Default master URL baked at build-time. The operator can override this
      // at runtime from the Settings page (stored in localStorage).
      __MASTER_URL__: JSON.stringify(`http://127.0.0.1:${masterPort}`),
    },
  };
});
