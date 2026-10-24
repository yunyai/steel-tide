import type { Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { type Plugin, runnerImport } from 'vite';
import { defineConfig } from 'vitest/config';

interface LanModule {
  attachLan(server: Server): unknown;
  lanUrls(server: Server): string[];
}

/**
 * Hosts the LAN lobby server on the same port as the game, in `vite` and `vite preview` alike.
 * The server module is loaded through Vite's module runner rather than imported here, so the
 * config bundle stays small.
 */
function lanLobby(): Plugin {
  const attach = async (http: Server | null, log: (msg: string) => void) => {
    if (!http) return;
    const { module: lan } = await runnerImport<LanModule>(fileURLToPath(new URL('./server/lan.ts', import.meta.url)));
    lan.attachLan(http);
    const announce = () => {
      const urls = lan.lanUrls(http);
      if (urls.length) for (const u of urls) log(`  LAN lobby ready, friends open ${u}`);
      else log('  LAN lobby ready on this computer only. Start with --host (npm run lan) to let friends join.');
    };
    if (http.listening) announce();
    else http.once('listening', announce);
  };
  return {
    name: 'steel-tide-lan',
    configureServer: (server) => attach(server.httpServer as Server | null, (m) => server.config.logger.info(m)),
    configurePreviewServer: (server) => attach(server.httpServer as Server, (m) => server.config.logger.info(m)),
  };
}

export default defineConfig({
  plugins: [lanLobby()],
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'server/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
