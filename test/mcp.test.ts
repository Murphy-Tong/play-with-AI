import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/http.ts';
import { RoomStore } from '../src/rooms.ts';
import { sandboxGame } from '../src/games/sandbox.ts';

const authToken = 'test-only-server-token-not-a-real-secret-123456';

async function setup(t: TestContext, store = new RoomStore([sandboxGame])) {
  const server = createServer(createApp({ authToken, store }));
  const clients: Client[] = [];
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  t.after(async () => {
    await Promise.all(clients.map((client) => client.close()));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return {
    url,
    async connect() {
      const client = new Client({ name: 'integration-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
      }));
      return client;
    },
  };
}

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent);
  const content = result.content as { type: string; text?: string }[];
  assert.deepEqual(JSON.parse(content[0]!.text!), result.structuredContent);
  return result.structuredContent as T;
}

async function expectError(client: Client, name: string, args: Record<string, unknown>, code: string) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { error: { code: string } }).error.code, code);
}

test('MCP advertises discoverable game schemas and the room tools', async (t) => {
  const { connect } = await setup(t);
  const client = await connect();
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'create_room', 'get_room', 'join_room', 'list_games', 'submit_action',
  ]);
  assert.equal(tools.tools.find((tool) => tool.name === 'get_room')?.annotations?.readOnlyHint, true);
  const { games } = await call<{ games: { id: string; actionSchema: { required: string[] } }[] }>(client, 'list_games');
  assert.equal(games[0]?.id, 'sandbox');
  assert.deepEqual(games[0]?.actionSchema.required, ['type', 'text']);
});

test('two independent HTTP MCP clients share a complete room/action flow', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  });
  const room = await call<ReturnType<RoomStore['getRoom']>>(human, 'get_room', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.equal(room.status, 'active');
  assert.equal(room.version, 2);
  await call(agent, 'submit_action', {
    roomId: host.room.id, playerToken: guest.playerToken, expectedVersion: 2,
    action: { type: 'message', text: 'I joined through MCP' },
  });
  const updated = await call<ReturnType<RoomStore['getRoom']>>(human, 'get_room', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.equal(updated.version, 3);
  assert.deepEqual(updated.state.messages, [
    { playerId: guest.room.selfPlayerId, text: 'I joined through MCP' },
  ]);
  assert.equal(JSON.stringify(updated).includes(guest.playerToken), false);
});

test('MCP domain errors are structured and stale actions cannot be replayed', async (t) => {
  const { connect } = await setup(t);
  const client = await connect();
  await expectError(client, 'create_room', { gameId: 'missing', playerName: 'Host' }, 'GAME_NOT_FOUND');
  const host = await call<ReturnType<RoomStore['createRoom']>>(client, 'create_room', {
    gameId: 'sandbox', playerName: 'Host',
  });
  await expectError(client, 'get_room', {
    roomId: host.room.id, playerToken: host.inviteToken,
  }, 'UNAUTHORIZED');
  await call(client, 'join_room', { roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Guest' });
  await expectError(client, 'submit_action', {
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 1,
    action: { type: 'message', text: 'stale' },
  }, 'VERSION_CONFLICT');
  await expectError(client, 'submit_action', {
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 2,
    action: { type: 'unknown' },
  }, 'INVALID_ACTION');
});

test('MCP validates tool inputs instead of accepting blank names or extra authority fields', async (t) => {
  const { connect } = await setup(t);
  const client = await connect();
  for (const args of [
    { gameId: 'sandbox', playerName: '   ' },
    { gameId: 'sandbox', playerName: 'x'.repeat(41) },
    { gameId: 'sandbox', playerName: 'Guest', playerId: 'admin' },
  ]) {
    const result = await client.callTool({ name: 'create_room', arguments: args });
    assert.equal(result.isError, true);
  }
});

test('internal adapter exceptions are not exposed to an MCP client', async (t) => {
  const store = new RoomStore([{
    ...sandboxGame,
    applyAction: () => { throw new Error('private-server-secret'); },
  }]);
  const { connect } = await setup(t, store);
  const client = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(client, 'create_room', {
    gameId: 'sandbox', playerName: 'Host',
  });
  await call(client, 'join_room', { roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Guest' });
  const result = await client.callTool({ name: 'submit_action', arguments: {
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 2,
    action: { type: 'message', text: 'trigger' },
  } });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(result).includes('private-server-secret'), false);
});

test('HTTP rejects unauthenticated requests and untrusted browser origins', async (t) => {
  const { url } = await setup(t);
  const unauthorizedHeaders: Record<string, string>[] = [{}, { Authorization: 'Bearer wrong' }];
  for (const headers of unauthorizedHeaders) {
    const response = await fetch(url, { method: 'POST', headers });
    assert.equal(response.status, 401);
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, Origin: 'https://untrusted.invalid' },
  });
  assert.equal(response.status, 403);
});

test('HTTP rejects DNS rebinding host headers', async (t) => {
  const { url } = await setup(t);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(url, {
      method: 'POST', headers: { Authorization: `Bearer ${authToken}`, Host: 'untrusted.invalid' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('HTTP rejects unsupported methods without advertising a persistent SSE stream', async (t) => {
  const { url } = await setup(t);
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${authToken}` } });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('HTTP returns bounded JSON errors for malformed and oversized requests', async (t) => {
  const { url } = await setup(t);
  for (const [body, status] of [['{', 400], [JSON.stringify({ data: 'x'.repeat(70_000) }), 413]] as const) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal(JSON.stringify(await response.json()).includes('node_modules'), false);
  }
});
