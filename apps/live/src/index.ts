// Load .env before anything reads process.env. No-ops when a file is absent
// (e.g. Docker/prod, where env is injected), so it's safe in every environment.
import 'dotenv/config';
import http from 'node:http';
import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { WebSocketServer } from 'ws';
import { loadEnv } from './env';
import { connectMongo, closeMongo, fetchState, storeState } from './db';
import { makeOnAuthenticate } from './auth';
import { makeOnStoreDocument } from './snapshot';

async function main(): Promise<void> {
  const env = loadEnv();

  // Independent Mongo connection (not a Nest module). Shares the DB with the
  // API; owns the `yjsdocuments` collection.
  await connectMongo(env.MONGODB_URI);

  const server = new Hocuspocus({
    // onStoreDocument (persistence + snapshot-back) is debounced so a burst of
    // keystrokes collapses into one store; maxDebounce guarantees a flush during
    // long sessions (ADR 0001 §4).
    debounce: 2000,
    maxDebounce: 10000,

    extensions: [
      new Database({
        fetch: async ({ documentName }) => fetchState(documentName),
        store: async ({ documentName, state }) => storeState(documentName, state),
      }),
    ],

    onAuthenticate: makeOnAuthenticate(env),
    onStoreDocument: makeOnStoreDocument(env),
  });

  // Custom HTTP server so we can (a) serve a health check and (b) enforce the
  // WS Origin allowlist at upgrade time (ADR 0001 §7).
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'live' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;

    // Enforce the allowlist for browser-originated upgrades. A present-but-
    // unlisted Origin is rejected outright. (Auth still gates every connection
    // via the JWT in onAuthenticate — this is defense in depth.)
    if (origin && !env.allowedOrigins.has(origin)) {
      console.warn(`[live] rejected WS upgrade from disallowed origin: ${origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      server.handleConnection(ws, request);
    });
  });

  httpServer.listen(env.PORT, () => {
    console.log(`[live] Hocuspocus listening on :${env.PORT}`);
    console.log(
      `[live] allowed origins: ${[...env.allowedOrigins].join(', ') || '(none)'}`,
    );
  });

  // --- Graceful shutdown: flush docs, close WS + Mongo. ---
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[live] ${signal} received — shutting down...`);
    try {
      await server.destroy(); // closes connections and flushes pending stores
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await closeMongo();
      console.log('[live] shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[live] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[live] fatal startup error:', err);
  process.exit(1);
});
