import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { RoomStore } from '../src/rooms.ts';
import { sandboxGame } from '../src/games/sandbox.ts';
import type { GameDefinition, JsonObject } from '../src/game.ts';

const actionGame: GameDefinition = {
  id: 'action-test', title: 'Action test', description: 'Fixture',
  minPlayers: 2, maxPlayers: 2,
  actionSchema: z.strictObject({ type: z.literal('message'), text: z.string().trim().min(1).max(2000) }),
  initialState: () => ({ messages: [] }),
  getPlayerView: (state) => state,
  applyAction: (state, context, action) => ({
    state: {
      messages: [
        ...(state.messages as { playerId: string; text: string }[]),
        { playerId: context.playerId, text: action.text as string },
      ].slice(-50),
    },
    finished: false,
  }),
};

function setup() {
  const store = new RoomStore([actionGame]);
  const host = store.createRoom({ gameId: actionGame.id, playerName: 'Human' });
  return { store, host };
}

function join(store: RoomStore, host: ReturnType<RoomStore['createRoom']>) {
  return store.joinRoom({
    roomId: host.room.id,
    inviteToken: host.inviteToken,
    playerName: 'Agent',
  });
}

test('a creator receives private credentials and a waiting room', () => {
  const { store, host } = setup();
  assert.equal(host.room.status, 'waiting');
  assert.equal(host.room.version, 1);
  assert.equal(host.room.players.length, 1);
  assert.equal(host.room.players[0]?.name, 'Human');
  assert.ok(host.playerToken.length >= 32);
  assert.notEqual(host.playerToken, host.inviteToken);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(JSON.stringify(view).includes(host.playerToken), false);
  assert.equal(JSON.stringify(view).includes(host.inviteToken), false);
});

test('a valid invitation joins a second player and activates the room', () => {
  const { store, host } = setup();
  const guest = join(store, host);
  assert.equal(guest.room.status, 'active');
  assert.equal(guest.room.version, 2);
  assert.equal(guest.room.players.length, 2);
  assert.notEqual(guest.room.selfPlayerId, host.room.selfPlayerId);
  assert.notEqual(guest.playerToken, host.playerToken);
  assert.equal(JSON.stringify(guest).includes(host.inviteToken), false);
});

test('invalid invitations cannot join or change the room version', () => {
  const { store, host } = setup();
  assert.throws(() => store.joinRoom({
    roomId: host.room.id, inviteToken: 'wrong', playerName: 'Intruder',
  }), { code: 'INVALID_INVITE' });
  assert.equal(store.getRoom({ roomId: host.room.id, playerToken: host.playerToken }).version, 1);
});

test('joining a full room is rejected', () => {
  const { store, host } = setup();
  join(store, host);
  assert.throws(() => join(store, host), { code: 'ROOM_FULL' });
});

test('player credentials are required and scoped to one room', () => {
  const { store, host } = setup();
  const other = store.createRoom({ gameId: actionGame.id, playerName: 'Other' });
  for (const playerToken of [host.inviteToken, other.playerToken, 'wrong']) {
    assert.throws(() => store.getRoom({ roomId: host.room.id, playerToken }), { code: 'UNAUTHORIZED' });
  }
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: other.playerToken,
    expectedVersion: 1, action: { type: 'message', text: 'spoof' },
  }), { code: 'UNAUTHORIZED' });
});

test('actions cannot run before the game has enough players', () => {
  const { store, host } = setup();
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: 1, action: { type: 'message', text: 'hello' },
  }), { code: 'ROOM_NOT_READY' });
});

test('accepted actions update the shared state using the authenticated player identity', () => {
  const { store, host } = setup();
  const guest = join(store, host);
  const result = store.submitAction({
    roomId: host.room.id, playerToken: guest.playerToken,
    expectedVersion: 2, action: { type: 'message', text: 'Hello human' },
  });
  assert.equal(result.version, 3);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.deepEqual(view.state.messages, [
    { playerId: guest.room.selfPlayerId, text: 'Hello human' },
  ]);
  assert.equal(view.selfPlayerId, host.room.selfPlayerId);
});

test('stale or replayed actions fail without executing twice', () => {
  const { store, host } = setup();
  join(store, host);
  const input = {
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: 2, action: { type: 'message', text: 'once' },
  };
  store.submitAction(input);
  assert.throws(() => store.submitAction(input), { code: 'VERSION_CONFLICT' });
  const view = store.getRoom(input);
  assert.equal(view.version, 3);
  assert.equal((view.state.messages as unknown[]).length, 1);
});

test('invalid actions do not advance the version or accept forged player identities', () => {
  const { store, host } = setup();
  join(store, host);
  const invalidActions: JsonObject[] = [
    { type: 'unknown' },
    { type: 'message', text: '' },
    { type: 'message', text: 'x'.repeat(2001) },
    { type: 'message', text: 'spoof', playerId: 'someone-else' },
  ];
  for (const action of invalidActions) {
    assert.throws(() => store.submitAction({
      roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 2, action,
    }), { code: 'INVALID_ACTION' });
  }
  assert.equal(store.getRoom({ roomId: host.room.id, playerToken: host.playerToken }).version, 2);
});

test('returned views cannot mutate stored state or player names', () => {
  const { store, host } = setup();
  join(store, host);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  view.players[0]!.name = 'Changed';
  view.state.messages = ['injected'];
  const next = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(next.players[0]?.name, 'Human');
  assert.deepEqual(next.state.messages, []);
});

test('game adapters project private views and control completion without a fixed turn system', () => {
  const game: GameDefinition = {
    id: 'private-test', title: 'Private test', description: 'Test fixture',
    minPlayers: 2, maxPlayers: 2,
    actionSchema: z.strictObject({}),
    initialState: () => ({ secret: 'never expose', done: false }),
    getPlayerView: (state, context) => ({ viewer: context.playerId, done: state.done! }),
    applyAction: (state) => ({ state: { ...state, done: true }, finished: true }),
  };
  const store = new RoomStore([game]);
  const host = store.createRoom({ gameId: game.id, playerName: 'Host' });
  const guest = join(store, host);
  assert.deepEqual(guest.room.state, { viewer: guest.room.selfPlayerId, done: false });
  assert.equal(JSON.stringify(guest.room).includes('never expose'), false);
  const view = store.submitAction({
    roomId: host.room.id, playerToken: guest.playerToken, expectedVersion: 2, action: {},
  });
  assert.equal(view.status, 'finished');
  assert.equal(view.state.done, true);
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 3, action: {},
  }), { code: 'ROOM_FINISHED' });
});

test('a rejected game transition cannot partially mutate room state', () => {
  const game: GameDefinition = {
    ...actionGame,
    applyAction: (state) => {
      state.messages = ['corrupted'];
      throw new Error('adapter failed');
    },
  };
  const store = new RoomStore([game]);
  const host = store.createRoom({ gameId: game.id, playerName: 'Host' });
  join(store, host);
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 2,
    action: { type: 'message', text: 'trigger adapter' },
  }), /adapter failed/);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(view.version, 2);
  assert.deepEqual(view.state.messages, []);
});

test('failed join projections leave the seat and version unchanged so joining can be retried', () => {
  let projectionFails = true;
  const game: GameDefinition = {
    ...actionGame,
    getPlayerView: (state, context) => {
      if (projectionFails && context.playerId !== context.players[0]?.id) {
        throw new Error('projection failed');
      }
      return state;
    },
  };
  const store = new RoomStore([game]);
  const host = store.createRoom({ gameId: game.id, playerName: 'Host' });
  assert.throws(() => join(store, host), /projection failed/);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(view.version, 1);
  assert.equal(view.status, 'waiting');
  assert.equal(view.players.length, 1);
  projectionFails = false;
  const guest = join(store, host);
  assert.equal(guest.room.version, 2);
  assert.equal(guest.room.players.length, 2);
});

test('failed action projections do not commit the new game state', () => {
  let projectionFails = true;
  const game: GameDefinition = {
    ...actionGame,
    getPlayerView: (state) => {
      if (projectionFails && (state.messages as unknown[]).length > 0) {
        throw new Error('projection failed');
      }
      return state;
    },
  };
  const store = new RoomStore([game]);
  const host = store.createRoom({ gameId: game.id, playerName: 'Host' });
  join(store, host);
  const input = {
    roomId: host.room.id, playerToken: host.playerToken, expectedVersion: 2,
    action: { type: 'message', text: 'must not commit' },
  };
  assert.throws(() => store.submitAction(input), /projection failed/);
  projectionFails = false;
  const view = store.getRoom(input);
  assert.equal(view.version, 2);
  assert.deepEqual(view.state.messages, []);
  assert.equal(store.submitAction(input).version, 3);
});

test('unknown games and unknown rooms return explicit errors', () => {
  const store = new RoomStore([sandboxGame]);
  assert.throws(() => store.createRoom({ gameId: 'go', playerName: 'Host' }), { code: 'GAME_NOT_FOUND' });
  assert.throws(() => store.getRoom({ roomId: 'missing', playerToken: 'missing' }), { code: 'ROOM_NOT_FOUND' });
});

test('action history stays bounded while accepting later messages', () => {
  const { store, host } = setup();
  join(store, host);
  for (let i = 0; i < 55; i += 1) {
    store.submitAction({
      roomId: host.room.id, playerToken: host.playerToken, expectedVersion: i + 2,
      action: { type: 'message', text: `message ${i}` },
    });
  }
  const messages = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken }).state.messages as unknown[];
  assert.equal(messages.length, 50);
  assert.deepEqual(messages.at(-1), { playerId: host.room.selfPlayerId, text: 'message 54' });
});

test('image drops are authenticated, validated, bounded, and do not change the game version', () => {
  const { store, host } = setup();
  const guest = join(store, host);
  const input = {
    roomId: host.room.id, playerToken: guest.playerToken,
    imageUrl: '  https://example.test/boom.png  ', caption: '  看招  ',
  };
  const view = store.sendImage(input);
  assert.equal(view.version, 2);
  assert.equal(view.revision, 3);
  assert.equal(view.imageDrops.length, 1);
  const drop = view.imageDrops[0]!;
  assert.equal(drop.playerId, guest.room.selfPlayerId);
  assert.equal(drop.url, 'https://example.test/boom.png');
  assert.equal(drop.caption, '看招');
  const emptyCaption = store.sendImage({ ...input, caption: '   ' });
  assert.equal('caption' in emptyCaption.imageDrops[1]!, false);

  const clone = store.getRoom(input);
  clone.imageDrops[0]!.url = 'https://changed.test/x.png';
  assert.equal(store.getRoom(input).imageDrops[0]!.url, 'https://example.test/boom.png');

  for (const imageUrl of ['', 'ftp://example.test/a.png', 'javascript:alert(1)', `https://example.test/${'x'.repeat(2048)}`]) {
    assert.throws(() => store.sendImage({ ...input, imageUrl }), { code: 'INVALID_IMAGE' });
  }
  assert.throws(() => store.sendImage({ ...input, caption: 'x'.repeat(81) }), { code: 'INVALID_IMAGE' });
  assert.throws(() => store.sendImage({ ...input, playerToken: host.inviteToken }), { code: 'UNAUTHORIZED' });

  for (let i = 0; i < 25; i += 1) {
    store.sendImage({ ...input, imageUrl: `https://example.test/${i}.png` });
  }
  const drops = store.getRoom(input).imageDrops;
  assert.equal(drops.length, 20);
  assert.equal(drops.at(-1)!.url, 'https://example.test/24.png');
  assert.equal(store.getRoom(input).version, 2);
});

test('waitForChange wakes on the next game action and otherwise times out', async () => {
  const { store, host } = setup();
  const guest = join(store, host);
  const access = { roomId: host.room.id, playerToken: guest.playerToken };
  const latest = store.getRoom(access);

  const immediate = await store.waitForChange({ ...access, afterRevision: latest.revision - 1, timeoutMs: 1000 });
  assert.equal(immediate.revision, latest.revision);

  const waiting = store.waitForChange({ ...access, afterRevision: latest.revision, timeoutMs: 1000 });
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 20));
  store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: latest.version, action: { type: 'message', text: 'move' },
  });
  const woke = await waiting;
  assert.equal(woke.version, latest.version + 1);
  assert.equal(woke.revision, latest.revision + 1);
  assert.ok(Date.now() - started < 900);

  const quiet = await store.waitForChange({ ...access, afterRevision: woke.revision, timeoutMs: 30 });
  assert.equal(quiet.revision, woke.revision);

  await assert.rejects(
    store.waitForChange({ ...access, playerToken: 'nope', afterRevision: 1, timeoutMs: 1000 }),
    { code: 'UNAUTHORIZED' },
  );
});

test('sandbox is chat-only and cannot accept game actions', () => {
  const store = new RoomStore([sandboxGame]);
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human' });
  store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: 2, action: { type: 'message', text: 'legacy' },
  }), { code: 'INVALID_ACTION' });
});

test('joining again with the same clientId restores the seat instead of failing with ROOM_FULL', () => {
  const store = new RoomStore([sandboxGame]);
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human', clientId: 'human-browser' });
  const first = store.joinRoom({
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent', clientId: 'lingjun',
  });
  assert.equal(first.recovered, false);
  const recovered = store.joinRoom({
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent', clientId: 'lingjun',
  });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.room.selfPlayerId, first.room.selfPlayerId);
  assert.equal(recovered.room.version, first.room.version);
  assert.deepEqual(recovered.room.state, first.room.state);
  assert.equal(recovered.room.revision, first.room.revision + 1);
  assert.equal(recovered.room.players.length, 2);
  assert.notEqual(recovered.playerToken, first.playerToken);
  assert.throws(() => store.getRoom({ roomId: host.room.id, playerToken: first.playerToken }), { code: 'UNAUTHORIZED' });
  assert.equal(store.getRoom({ roomId: host.room.id, playerToken: recovered.playerToken }).selfPlayerId, first.room.selfPlayerId);

  const hostSeat = store.joinRoom({
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Human', clientId: 'human-browser',
  });
  assert.equal(hostSeat.recovered, true);
  assert.equal(hostSeat.room.selfPlayerId, host.room.selfPlayerId);
});

test('a full room tells the client how to recover or free a seat', () => {
  const { store, host } = setup();
  join(store, host);
  assert.throws(
    () => store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Third', clientId: 'other' }),
    (error: Error & { code?: string }) => error.code === 'ROOM_FULL' && /clientId/.test(error.message),
  );
});

test('idle seats are released on the next join without disturbing the active player', async () => {
  const store = new RoomStore([sandboxGame], { idleSeatMs: 20 });
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human' });
  const guest = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Ghost' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  const replacement = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.equal(replacement.recovered, false);
  assert.equal(replacement.room.players.length, 2);
  assert.equal(replacement.room.players.some((player) => player.id === guest.room.selfPlayerId), false);
  assert.throws(() => store.getRoom({ roomId: host.room.id, playerToken: guest.playerToken }), { code: 'UNAUTHORIZED' });
});

test('leaving releases the seat and hands the host role to the remaining player', () => {
  const store = new RoomStore([sandboxGame]);
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human' });
  const guest = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.deepEqual(store.leaveRoom({ roomId: host.room.id, playerToken: host.playerToken }), { roomId: host.room.id, left: true });
  const remaining = store.getRoom({ roomId: host.room.id, playerToken: guest.playerToken });
  assert.equal(remaining.players.length, 1);
  assert.equal(remaining.hostId, guest.room.selfPlayerId);
  assert.equal(remaining.status, 'waiting');
  assert.throws(() => store.getRoom({ roomId: host.room.id, playerToken: host.playerToken }), { code: 'UNAUTHORIZED' });
  const fresh = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'New agent' });
  assert.equal(fresh.room.players.length, 2);
  assert.equal(fresh.room.status, 'active');
});

test('only the host can release another seat', () => {
  const { store, host } = setup();
  const guest = join(store, host);
  assert.throws(() => store.kickPlayer({
    roomId: host.room.id, playerToken: guest.playerToken, targetPlayerId: host.room.selfPlayerId,
  }), { code: 'FORBIDDEN' });
  assert.throws(() => store.kickPlayer({
    roomId: host.room.id, playerToken: host.playerToken, targetPlayerId: host.room.selfPlayerId,
  }), { code: 'INVALID_TARGET' });
  const view = store.kickPlayer({
    roomId: host.room.id, playerToken: host.playerToken, targetPlayerId: guest.room.selfPlayerId,
  });
  assert.equal(view.players.length, 1);
  assert.equal(view.hostId, host.room.selfPlayerId);
  assert.equal(view.status, 'waiting');
  assert.throws(() => store.getRoom({ roomId: host.room.id, playerToken: guest.playerToken }), { code: 'UNAUTHORIZED' });
  assert.throws(() => store.kickPlayer({
    roomId: host.room.id, playerToken: host.playerToken, targetPlayerId: guest.room.selfPlayerId,
  }), { code: 'PLAYER_NOT_FOUND' });
});
