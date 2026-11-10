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
import { sandboxGame } from '../src/games/sandbox.ts';
import { gomokuGame } from '../src/games/gomoku.ts';
import type { GameDefinition } from '../src/game.ts';

const finishGame: GameDefinition = {
  id: 'finish-test', title: 'Finish test', description: 'Fixture',
  minPlayers: 2, maxPlayers: 2,
  actionSchema: z.strictObject({ type: z.literal('finish') }),
  initialState: () => ({ done: false }),
  getPlayerView: (state) => state,
  applyAction: () => ({ state: { done: true }, finished: true }),
  restart: () => ({ done: false, restarted: true }),
};

async function setup(t: TestContext, store = new RoomStore([sandboxGame, gomokuGame])) {
  const server = createServer(createApp({ store }));
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
      await client.connect(new StreamableHTTPClientTransport(url));
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
    'create_room', 'drop_image', 'get_room', 'join_room', 'leave_room', 'list_games',
    'request_rematch', 'send_chat_message', 'submit_action', 'wait_for_room_update',
  ]);
  assert.equal(tools.tools.find((tool) => tool.name === 'get_room')?.annotations?.readOnlyHint, true);
  const { games } = await call<{ games: { id: string; actionSchema: { required: string[] } | null }[] }>(client, 'list_games');
  const sandbox = games.find((game) => game.id === 'sandbox');
  const gomoku = games.find((game) => game.id === 'gomoku');
  assert.equal(sandbox?.actionSchema, null);
  assert.deepEqual(gomoku?.actionSchema?.required, ['type', 'row', 'col']);
});

test('two independent HTTP MCP clients share a complete room/chat flow', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  });
  await call(agent, 'send_chat_message', {
    roomId: host.room.id, playerToken: guest.playerToken, text: 'I joined through MCP',
  });
  const updated = await call<ReturnType<RoomStore['getRoom']>>(human, 'get_room', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.chat.map((message) => message.text), ['I joined through MCP']);
  assert.equal(JSON.stringify(updated).includes(guest.playerToken), false);
});

test('MCP chat is room-level, shared by both players, and does not change the game version', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human', avatarUrl: 'https://example.test/me.png',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
    avatarUrl: 'https://example.test/agent.png',
  });
  await call(agent, 'send_chat_message', {
    roomId: host.room.id, playerToken: guest.playerToken, text: '  我先说一句  ',
  });
  const updated = await call<ReturnType<RoomStore['getRoom']>>(human, 'get_room', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.chat.length, 1);
  assert.equal(updated.chat[0]!.text, '我先说一句');
  assert.equal(updated.players[0]!.avatarUrl, 'https://example.test/me.png');
  assert.equal(updated.players[1]!.avatarUrl, 'https://example.test/agent.png');
  assert.equal(JSON.stringify(updated).includes(guest.playerToken), false);
});

test('MCP rematch requires both players and restarts the game', async (t) => {
  const { connect } = await setup(t, new RoomStore([finishGame]));
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'finish-test', playerName: 'Human',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  });
  await call(human, 'submit_action', {
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: guest.room.version, action: { type: 'finish' },
  });
  const first = await call<ReturnType<RoomStore['requestRematch']>>(human, 'request_rematch', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.deepEqual(first.rematchVotes, [host.room.selfPlayerId]);
  const restarted = await call<ReturnType<RoomStore['requestRematch']>>(agent, 'request_rematch', {
    roomId: host.room.id, playerToken: guest.playerToken,
  });
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.state.restarted, true);
});

test('MCP image drops are room-level and visible in the shared view', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  });
  const dropped = await call<ReturnType<RoomStore['sendImage']>>(agent, 'drop_image', {
    roomId: host.room.id, playerToken: guest.playerToken,
    imageUrl: 'https://example.test/boom.png', caption: ' 看招 ',
  });
  assert.equal(dropped.version, 2);
  assert.equal(dropped.imageDrops.length, 1);
  assert.equal(dropped.imageDrops[0]!.playerId, guest.room.selfPlayerId);
  assert.equal(dropped.imageDrops[0]!.url, 'https://example.test/boom.png');
  assert.equal(dropped.imageDrops[0]!.caption, '看招');
  const updated = await call<ReturnType<RoomStore['getRoom']>>(human, 'get_room', {
    roomId: host.room.id, playerToken: host.playerToken,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.imageDrops[0]!.id, dropped.imageDrops[0]!.id);
  assert.equal(JSON.stringify(updated).includes(guest.playerToken), false);
  await expectError(agent, 'drop_image', {
    roomId: host.room.id, playerToken: guest.playerToken, imageUrl: 'javascript:alert(1)',
  }, 'INVALID_IMAGE');
});

test('MCP wait_for_room_update returns on the next change and honors its timeout', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  });
  const current = await call<ReturnType<RoomStore['getRoom']>>(agent, 'get_room', {
    roomId: host.room.id, playerToken: guest.playerToken,
  });
  const waiting = call<ReturnType<RoomStore['getRoom']>>(agent, 'wait_for_room_update', {
    roomId: host.room.id, playerToken: guest.playerToken, afterRevision: current.revision, timeoutSeconds: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await call(human, 'send_chat_message', {
    roomId: host.room.id, playerToken: host.playerToken, text: 'your turn',
  });
  const woke = await waiting;
  assert.equal(woke.revision, current.revision + 1);
  assert.equal(woke.chat.at(-1)?.text, 'your turn');
  const timedOut = await call<ReturnType<RoomStore['getRoom']>>(agent, 'wait_for_room_update', {
    roomId: host.room.id, playerToken: guest.playerToken, afterRevision: woke.revision, timeoutSeconds: 1,
  });
  assert.equal(timedOut.revision, woke.revision);
});

test('MCP join_room restores a seat by clientId and leave_room frees it', async (t) => {
  const { connect } = await setup(t);
  const human = await connect();
  const agent = await connect();
  const host = await call<ReturnType<RoomStore['createRoom']>>(human, 'create_room', {
    gameId: 'sandbox', playerName: 'Human', clientId: 'human-host',
  });
  const guest = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent', clientId: 'lingjun',
  });
  assert.equal(guest.recovered, false);
  const recovered = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent', clientId: 'lingjun',
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.room.selfPlayerId, guest.room.selfPlayerId);
  assert.equal(recovered.room.version, guest.room.version);
  await expectError(agent, 'get_room', { roomId: host.room.id, playerToken: guest.playerToken }, 'UNAUTHORIZED');
  const left = await call<{ roomId: string; left: true }>(agent, 'leave_room', {
    roomId: host.room.id, playerToken: recovered.playerToken,
  });
  assert.deepEqual(left, { roomId: host.room.id, left: true });
  const replacement = await call<ReturnType<RoomStore['joinRoom']>>(agent, 'join_room', {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent 2', clientId: 'lingjun-2',
  });
  assert.equal(replacement.room.players.length, 2);
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
    id: 'sandbox',
    actionSchema: z.strictObject({ type: z.literal('message'), text: z.string() }),
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

test('HTTP serves MCP without credentials but rejects untrusted browser origins', async (t) => {
  const { url } = await setup(t);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.invalid' },
  });
  assert.equal(response.status, 403);
});

test('HTTP rejects DNS rebinding host headers', async (t) => {
  const { url } = await setup(t);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(url, {
      method: 'POST', headers: { Host: 'untrusted.invalid' },
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
    const response = await fetch(url, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  }
});

test('HTTP returns bounded JSON errors for malformed and oversized requests', async (t) => {
  const { url } = await setup(t);
  for (const [body, status] of [['{', 400], [JSON.stringify({ data: 'x'.repeat(70_000) }), 413]] as const) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal(JSON.stringify(await response.json()).includes('node_modules'), false);
  }
});
