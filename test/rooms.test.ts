import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { RoomStore } from '../src/rooms.ts';
import { sandboxGame } from '../src/games/sandbox.ts';
import type { GameDefinition, JsonObject } from '../src/game.ts';

function setup() {
  const store = new RoomStore([sandboxGame]);
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human' });
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
  const other = store.createRoom({ gameId: 'sandbox', playerName: 'Other' });
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
    ...sandboxGame,
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
    ...sandboxGame,
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
    ...sandboxGame,
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

test('sandbox history stays bounded while accepting later messages', () => {
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
