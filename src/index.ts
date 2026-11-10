#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as z from 'zod';
import { createApp } from './http.ts';
import { RoomStore } from './rooms.ts';
import { gomokuGame } from './games/gomoku.ts';
import { sandboxGame } from './games/sandbox.ts';

const config = z.object({
  PORT: z.string().regex(/^\d{1,5}$/).default('3001').transform(Number).pipe(z.number().max(65535)),
  MCP_AUTH_TOKEN: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).safeParse(process.env);

if (!config.success) {
  console.error(`Invalid configuration: ${config.error.issues.map((issue) => issue.path.join('.')).join(', ')}. PORT must be 0–65535; MCP_AUTH_TOKEN must contain 32–256 letters, digits, underscores or hyphens.`);
  process.exitCode = 1;
} else {
  const development = process.argv.includes('--dev');
  const lan = process.argv.includes('--lan');
  const webHosts = lan ? Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address),
  ) : [];
  const host = lan ? '0.0.0.0' : '127.0.0.1';
  const authToken = config.data.MCP_AUTH_TOKEN ?? randomBytes(32).toString('base64url');
  const app = createApp({ authToken, store: new RoomStore([gomokuGame, sandboxGame]), webHosts });
  const server = createServer(app);
  let closeVite: (() => Promise<void>) | undefined;

  if (development) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      server: { middlewareMode: true, hmr: { server }, host },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else {
    app.use(express.static(fileURLToPath(new URL('../dist/web', import.meta.url))));
  }

  server.listen(config.data.PORT, host, () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      console.log(JSON.stringify({
        url: `http://127.0.0.1:${address.port}/mcp`,
        web: `http://127.0.0.1:${address.port}`,
        ...(lan ? { lan: webHosts.map((ip) => `http://${ip}:${address.port}`), notice: 'Web UI is available on your LAN. Use only a trusted network; MCP remains loopback-only.' } : {}),
        transport: 'streamable-http',
        authorization: config.data.MCP_AUTH_TOKEN ? 'Bearer <MCP_AUTH_TOKEN>' : `Bearer ${authToken}`,
        storage: 'in-memory; restarting clears rooms',
      }));
    }
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`Unable to start server (${error.code}).`);
    process.exitCode = 1;
    void closeVite?.();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void closeVite?.();
      server.close();
    });
  }
}
