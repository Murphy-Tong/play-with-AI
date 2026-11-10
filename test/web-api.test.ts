import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as z from 'zod';
import { createApp } from '../src/http.ts';
import { RoomStore } from '../src/rooms.ts';
import type { RoomView } from '../src/rooms.ts';
import { sandboxGame } from '../src/games/sandbox.ts';
import type { GameDefinition } from '../src/game.ts';

type Created = ReturnType<RoomStore['createRoom']>;

async function setup(t: TestContext, store = new RoomStore([sandboxGame]), webHosts: string[] = []) {
  const server = createServer(createApp({ store, webHosts }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const post = (path: string, body: unknown, token?: string) => fetch(`${base}/api${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const create = async () => {
    const response = await post('/rooms', { gameId: 'sandbox', playerName: 'Human' });
    assert.equal(response.status, 201);
    return await response.json() as Created;
  };
  return { base, post, create };
}

async function assertError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type')!, /application\/json/);
  assert.equal((await response.json()).error.code, code);
}

test('web games and MCP chat share the same room', async (t) => {
  const { base, create, post } = await setup(t);
  const games = await fetch(`${base}/api/games`);
  assert.equal(games.status, 200);
  assert.equal(games.headers.get('cache-control'), 'no-store');
  assert.equal((await games.json()).games[0].id, 'sandbox');
  const host = await create();
  assert.equal(host.room.status, 'waiting');
  const client = new Client({ name: 'web-integration-agent', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const joined = await client.callTool({ name: 'join_room', arguments: {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  } });
  assert.notEqual(joined.isError, true);
  const guest = joined.structuredContent as ReturnType<RoomStore['joinRoom']>;
  const sent = await post(`/rooms/${host.room.id}/chat`, { text: 'Hello from the browser' }, host.playerToken);
  assert.equal(sent.status, 200);
  const action = await client.callTool({ name: 'send_chat_message', arguments: {
    roomId: host.room.id, playerToken: guest.playerToken, text: 'Hello from MCP',
  } });
  assert.notEqual(action.isError, true);
  const response = await fetch(`${base}/api/rooms/${host.room.id}`, { headers: { Authorization: `Bearer ${host.playerToken}` } });
  const room = await response.json() as RoomView;
  assert.equal(room.version, 2);
  assert.equal(room.selfPlayerId, host.room.selfPlayerId);
  assert.deepEqual(room.chat.map((message) => message.text), ['Hello from the browser', 'Hello from MCP']);
  assert.equal(JSON.stringify(room).includes(guest.playerToken), false);
});

test('the browser room view receives image drops sent through MCP', async (t) => {
  const { base, create } = await setup(t);
  const host = await create();
  const client = new Client({ name: 'image-agent', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const joined = await client.callTool({ name: 'join_room', arguments: {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  } });
  const guest = joined.structuredContent as ReturnType<RoomStore['joinRoom']>;
  const dropped = await client.callTool({ name: 'drop_image', arguments: {
    roomId: host.room.id, playerToken: guest.playerToken,
    imageUrl: 'https://example.test/boom.png', caption: 'BOOM',
  } });
  assert.notEqual(dropped.isError, true);
  const room = await (await fetch(`${base}/api/rooms/${host.room.id}`, {
    headers: { Authorization: `Bearer ${host.playerToken}` },
  })).json() as RoomView;
  assert.equal(room.version, 2);
  assert.equal(room.imageDrops.length, 1);
  assert.equal(room.imageDrops[0]!.playerId, guest.room.selfPlayerId);
  assert.equal(room.imageDrops[0]!.caption, 'BOOM');
});

test('web and MCP chat share the same room and never change the game version', async (t) => {
  const { base, create, post } = await setup(t);
  const host = await create();
  const client = new Client({ name: 'chat-agent', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const joined = await client.callTool({ name: 'join_room', arguments: {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  } });
  const guest = joined.structuredContent as ReturnType<RoomStore['joinRoom']>;
  const browserChat = await post(`/rooms/${host.room.id}/chat`, { text: '  浏览器发来一句  ' }, host.playerToken);
  assert.equal(browserChat.status, 200);
  const agentChat = await client.callTool({ name: 'send_chat_message', arguments: {
    roomId: host.room.id, playerToken: guest.playerToken, text: 'Agent 也来了',
  } });
  assert.notEqual(agentChat.isError, true);
  const room = await (await fetch(`${base}/api/rooms/${host.room.id}`, {
    headers: { Authorization: `Bearer ${host.playerToken}` },
  })).json() as RoomView;
  assert.equal(room.version, 2);
  assert.deepEqual(room.chat.map((message) => message.text), ['浏览器发来一句', 'Agent 也来了']);
  assert.equal(JSON.stringify(room).includes(guest.playerToken), false);
});

test('web chat validates text and authentication without advancing revision', async (t) => {
  const { base, create, post } = await setup(t);
  const host = await create();
  for (const text of ['', '   ', 'x'.repeat(501)]) {
    const response = await post(`/rooms/${host.room.id}/chat`, { text }, host.playerToken);
    if (text.trim() === '') {
      await assertError(response, 400, 'INVALID_MESSAGE');
    } else {
      await assertError(response, 400, 'INVALID_INPUT');
    }
  }
  await assertError(await post(`/rooms/${host.room.id}/chat`, { text: 'hi', extra: true }, host.playerToken), 400, 'INVALID_INPUT');
  await assertError(await fetch(`${base}/api/rooms/${host.room.id}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  }), 401, 'UNAUTHORIZED');
});

test('web rematch is rejected before finish and works after both votes', async (t) => {
  const finishGame: GameDefinition = {
    id: 'finish-web', title: 'Finish web', description: 'Fixture',
    minPlayers: 2, maxPlayers: 2,
    actionSchema: z.strictObject({ type: z.literal('finish') }),
    initialState: () => ({ done: false }),
    getPlayerView: (state) => state,
    applyAction: () => ({ state: { done: true }, finished: true }),
    restart: () => ({ done: false, restarted: true }),
  };
  const store = new RoomStore([finishGame]);
  const { post } = await setup(t, store);
  const created = await post('/rooms', { gameId: 'finish-web', playerName: 'Human' });
  const host = await created.json() as Created;
  await assertError(await post(`/rooms/${host.room.id}/rematch`, {}, host.playerToken), 409, 'ROOM_NOT_FINISHED');
  const joinedResponse = await post(`/rooms/${host.room.id}/join`, {
    inviteToken: host.inviteToken, playerName: 'Agent',
  });
  const guest = await joinedResponse.json() as ReturnType<RoomStore['joinRoom']>;
  await post(`/rooms/${host.room.id}/actions`, {
    expectedVersion: guest.room.version, action: { type: 'finish' },
  }, host.playerToken);
  const first = await post(`/rooms/${host.room.id}/rematch`, {}, host.playerToken);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).rematchVotes.length, 1);
  const second = await post(`/rooms/${host.room.id}/rematch`, {}, guest.playerToken);
  assert.equal(second.status, 200);
  const restarted = await second.json() as RoomView;
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.state.restarted, true);
});

test('web room access requires a private player token rather than an invitation', async (t) => {
  const { base, create } = await setup(t);
  const host = await create();
  for (const token of ['', host.inviteToken, 'not-a-player-token']) {
    await assertError(await fetch(`${base}/api/rooms/${host.room.id}`, { headers: { Authorization: `Bearer ${token}` } }), 401, 'UNAUTHORIZED');
  }
});

test('web validation rejects blank names, extra fields, malformed ids and invalid actions', async (t) => {
  const { base, create, post } = await setup(t);
  for (const body of [
    { gameId: 'sandbox', playerName: '  ' },
    { gameId: 'sandbox', playerName: 'x'.repeat(41) },
    { gameId: 'sandbox', playerName: 'Human', playerId: 'someone-else' },
  ]) await assertError(await post('/rooms', body), 400, 'INVALID_INPUT');
  await assertError(await fetch(`${base}/api/rooms/not-a-uuid`, { headers: { Authorization: 'Bearer test' } }), 400, 'INVALID_INPUT');
  const host = await create();
  await assertError(await post(`/rooms/${host.room.id}/actions`, {
    expectedVersion: 1, action: { type: 'message', text: 'waiting' },
  }, host.playerToken), 409, 'ROOM_NOT_READY');
  const joined = await post(`/rooms/${host.room.id}/join`, { inviteToken: host.inviteToken, playerName: ' Guest ' });
  assert.equal(joined.status, 200);
  assert.equal((await joined.json()).room.players[1].name, 'Guest');
  await assertError(await post(`/rooms/${host.room.id}/actions`, {
    expectedVersion: 2, action: { type: 'message', text: ' ' },
  }, host.playerToken), 400, 'INVALID_ACTION');
  await assertError(await post(`/rooms/${host.room.id}/actions`, {
    expectedVersion: 2, action: { type: 'message', text: 'hello' }, playerId: 'spoofed',
  }, host.playerToken), 400, 'INVALID_INPUT');
});

test('web domain errors preserve actionable conflict and invitation codes', async (t) => {
  const { base, create, post } = await setup(t);
  await assertError(await post('/rooms', { gameId: 'missing', playerName: 'Host' }), 404, 'GAME_NOT_FOUND');
  await assertError(await fetch(`${base}/api/rooms/11111111-1111-4111-8111-111111111111`, { headers: { Authorization: 'Bearer absent' } }), 404, 'ROOM_NOT_FOUND');
  const host = await create();
  await assertError(await post(`/rooms/${host.room.id}/join`, { inviteToken: 'wrong', playerName: 'Guest' }), 403, 'INVALID_INVITE');
  await post(`/rooms/${host.room.id}/join`, { inviteToken: host.inviteToken, playerName: 'Guest' });
  await assertError(await post(`/rooms/${host.room.id}/join`, { inviteToken: host.inviteToken, playerName: 'Third' }), 409, 'ROOM_FULL');
  await assertError(await post(`/rooms/${host.room.id}/actions`, {
    expectedVersion: 1, action: { type: 'message', text: 'stale' },
  }, host.playerToken), 409, 'VERSION_CONFLICT');
});

test('web API rejects cross-origin requests without enabling CORS', async (t) => {
  const { base } = await setup(t);
  for (const headers of [{ Origin: 'https://untrusted.invalid' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: 'sandbox', playerName: 'Intruder' }) });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    await assertError(response, 403, 'FORBIDDEN');
  }
});

test('web API bounds bodies and always returns JSON for errors and missing routes', async (t) => {
  const { base } = await setup(t);
  await assertError(await fetch(`${base}/api/rooms`, { method: 'POST', body: '{}' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  for (const [body, status, code] of [['{', 400, 'INVALID_INPUT'], [JSON.stringify({ data: 'x'.repeat(70_000) }), 413, 'PAYLOAD_TOO_LARGE']] as const) {
    await assertError(await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), status, code);
  }
  await assertError(await fetch(`${base}/api/missing`), 404, 'NOT_FOUND');
});

test('web API sanitizes unexpected adapter errors', async (t) => {
  const store = new RoomStore([{ ...sandboxGame, initialState: () => { throw new Error('private-adapter-secret'); } }]);
  const { post } = await setup(t, store);
  const response = await post('/rooms', { gameId: 'sandbox', playerName: 'Host' });
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body.includes('private-adapter-secret'), false);
  assert.equal(body.includes('node_modules'), false);
  assert.equal(JSON.parse(body).error.code, 'INTERNAL_ERROR');
});

test('explicit LAN web hosts are accepted without expanding the MCP host boundary', async (t) => {
  const { base } = await setup(t, undefined, ['192.0.2.5']);
  const status = (path: string, host: string) => new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}${path}`, { headers: { Host: host } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(await status('/api/games', '192.0.2.5:3001'), 200);
  assert.equal(await status('/mcp', '192.0.2.5:3001'), 403);
  assert.equal(await status('/api/games', 'untrusted.invalid'), 403);
});
