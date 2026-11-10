import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { hostHeaderValidation, localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.ts';
import type { RoomStore } from './rooms.ts';
import { createWebApi } from './web-api.ts';

function isLoopback(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address?.startsWith('::ffff:127.') === true;
}

export function createApp(options: { store: RoomStore; webHosts?: string[] }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostHeaderValidation([...new Set(['localhost', '127.0.0.1', '[::1]', ...(options.webHosts ?? [])])]));
  app.use('/api', createWebApi(options.store));
  app.use('/mcp', localhostHostValidation(), (req, res, next) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'The MCP endpoint is only available on this computer.' });
      return;
    }
    if (req.headers.origin !== undefined) {
      res.status(403).json({ error: 'Browser origins are not supported by this local agent endpoint.' });
      return;
    }
    next();
  });

  app.post('/mcp', express.json({ limit: '64kb' }), async (req, res, next) => {
    const server = createMcpServer(options.store);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once('close', () => { void server.close().catch(next); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      next(error);
    }
  });

  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const type = (error as { type?: string } | null)?.type;
    const status = type === 'entity.too.large' ? 413 : type === 'entity.parse.failed' ? 400 : 500;
    const message = status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON.' : 'Internal server error.';
    res.status(status).json({ jsonrpc: '2.0', id: null, error: { code: status === 400 ? -32700 : -32603, message } });
  };
  app.use(handleError);
  return app;
}
