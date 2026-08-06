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
import { startReauthSweeper } from './reauth';
import { makeOnConnect, hasCapacity } from './limits';

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

    onConnect: makeOnConnect(env),
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

  // maxPayload is enforced by `ws` itself: an oversized frame is closed with
  // 1009 instead of being buffered, so it costs nothing to refuse (§3.3).
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: env.LIVE_MAX_PAYLOAD_BYTES,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;

    // Capacity check first — it's the cheapest refusal available, and the
    // point of it is to hold under load, including from valid sessions.
    if (!hasCapacity(wss.clients.size, env)) {
      console.warn(
        `[live] rejected WS upgrade: at server connection limit (${wss.clients.size}/${env.LIVE_MAX_CONNECTIONS})`,
      );
      socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 30\r\n\r\n');
      socket.destroy();
      return;
    }

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
      // MUST be attached before Hocuspocus takes the socket. `ws` emits
      // 'error' on a protocol violation — including the maxPayload refusal
      // above — and Hocuspocus registers no 'error' listener of its own. In
      // Node an unhandled 'error' event is a thrown exception, so without
      // this a single oversized frame from any client takes the whole server
      // down: a strictly worse DoS than the one maxPayload closes.
      // `ws` has already closed the socket (1009) by this point; there is
      // nothing to do but record it.
      ws.on('error', (err) => {
        console.warn(`[live] socket error (connection closed): ${err.message}`);
      });

      server.handleConnection(ws, request);
    });
  });

  // Collab tokens are short-lived, but the socket they opened is not: re-check
  // authorization periodically so revoked access actually disconnects.
  const stopReauth = startReauthSweeper(server, env);

  httpServer.listen(env.PORT, () => {
    console.log(`[live] Hocuspocus listening on :${env.PORT}`);
    console.log(
      `[live] allowed origins: ${[...env.allowedOrigins].join(', ') || '(none)'}`,
    );
    console.log(
      `[live] limits: maxPayload=${env.LIVE_MAX_PAYLOAD_BYTES}B · ` +
        `${env.LIVE_MAX_CONNECTIONS_PER_DOC} conns/doc · ` +
        `${env.LIVE_MAX_CONNECTIONS} conns total`,
    );
  });

  // --- Graceful shutdown: flush docs, close WS + Mongo. ---
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[live] ${signal} received — shutting down...`);
    try {
      stopReauth();
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
