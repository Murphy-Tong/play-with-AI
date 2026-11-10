import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as z from 'zod';
import { RoomStore } from '../src/rooms.ts';
import type { ChatMessage } from '../src/rooms.ts';
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

function setup(game: GameDefinition = sandboxGame, avatar = false) {
  const store = new RoomStore([game]);
  const host = store.createRoom({
    gameId: game.id, playerName: 'Human',
    ...(avatar ? { avatarUrl: ' https://example.test/me.png ' } : {}),
  });
  const guest = store.joinRoom({
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
    ...(avatar ? { avatarUrl: 'https://example.test/agent.png' } : {}),
  });
  return { store, host, guest };
}

test('chat appends messages, advances revision, and leaves version untouched', () => {
  const { store, host } = setup();
  const before = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  const after = store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: '  你好  ' });
  assert.equal(after.version, before.version);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.chat.length, 1);
  assert.equal(after.chat[0]!.text, '你好');
  assert.equal(after.chat[0]!.playerId, host.room.selfPlayerId);
  assert.ok(after.chat[0]!.id);
  assert.ok(after.chat[0]!.at);
});

test('chat rejects blank, oversized, and unauthenticated messages without changing revision', () => {
  const { store, host, guest } = setup();
  const before = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  for (const text of ['', '   ', 'x'.repeat(501)]) {
    assert.throws(() => store.sendChat({
      roomId: host.room.id, playerToken: host.playerToken, text,
    }), { code: 'INVALID_MESSAGE' });
  }
  assert.throws(() => store.sendChat({
    roomId: host.room.id, playerToken: guest.playerToken + 'x', text: 'spoof',
  }), { code: 'UNAUTHORIZED' });
  const after = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(after.revision, before.revision);
  assert.equal(after.chat.length, 0);
});

test('chat keeps only the latest 200 messages', () => {
  const { store, host } = setup();
  for (let index = 0; index < 205; index += 1) {
    store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: `message ${index}` });
  }
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(view.chat.length, 200);
  assert.equal(view.chat[0]!.text, 'message 5');
  assert.equal(view.chat.at(-1)!.text, 'message 204');
});

test('chat works while waiting, active, and finished', () => {
  const store = new RoomStore([finishGame]);
  const host = store.createRoom({ gameId: finishGame.id, playerName: 'Host' });
  store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: 'waiting' });
  const guest = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Guest' });
  store.sendChat({ roomId: host.room.id, playerToken: guest.playerToken, text: 'active' });
  store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: guest.room.version, action: { type: 'finish' },
  });
  const view = store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: 'finished' });
  assert.equal(view.status, 'finished');
  assert.deepEqual(view.chat.map((message: ChatMessage) => message.text), ['waiting', 'active', 'finished']);
});

test('avatars are trimmed, stored, and returned for both players', () => {
  const { store, host } = setup(sandboxGame, true);
  const view = store.getRoom({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(view.players[0]!.avatarUrl, 'https://example.test/me.png');
  assert.equal(view.players[1]!.avatarUrl, 'https://example.test/agent.png');
});

test('a rematch restarts the room immediately and keeps chat', () => {
  const { store, host, guest } = setup(finishGame);
  store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: 'good game' });
  const finished = store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: guest.room.version, action: { type: 'finish' },
  });
  assert.equal(finished.status, 'finished');
  const restarted = store.requestRematch({ roomId: host.room.id, playerToken: host.playerToken });
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.version, finished.version + 1);
  assert.equal(restarted.revision, finished.revision + 1);
  assert.equal(restarted.state.restarted, true);
  assert.equal(restarted.chat.length, 1);
  assert.equal(restarted.chat[0]!.text, 'good game');
});

test('a rematch restarts an in-progress game too', () => {
  const { store, host, guest } = setup(finishGame);
  assert.equal(guest.room.status, 'active');
  const restarted = store.requestRematch({ roomId: host.room.id, playerToken: guest.playerToken });
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.state.restarted, true);
  assert.equal(restarted.version, guest.room.version + 1);
});

test('a rematch waits until both players are seated', () => {
  const store = new RoomStore([finishGame]);
  const host = store.createRoom({ gameId: 'finish-test', playerName: 'Human' });
  assert.throws(() => store.requestRematch({
    roomId: host.room.id, playerToken: host.playerToken,
  }), { code: 'ROOM_NOT_READY' });
});

test('gomoku assigns creator black only when the room becomes active', () => {
  const store = new RoomStore([gomokuGame]);
  const host = store.createRoom({ gameId: 'gomoku', playerName: 'Human' });
  const guest = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.equal(guest.room.state.yourColor, 'white');
  assert.equal(host.room.selfPlayerId, (guest.room.state as { blackPlayerId: string }).blackPlayerId);
});
