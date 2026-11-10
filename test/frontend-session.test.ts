import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvitation, parseSession, roomErrorMessage, shouldAcceptRoom } from '../web/lib/session.ts';

const session = {
  roomId: '00000000-0000-4000-8000-000000000001',
  playerToken: 'private-token-do-not-share',
  inviteToken: 'shareable-invite',
  playerName: 'Human',
};

test('the agent invitation shares the invitation and room but never the player credential', () => {
  const text = buildInvitation(session);
  assert.ok(text.includes(session.roomId));
  assert.ok(text.includes(session.inviteToken));
  assert.ok(text.includes('join_room'));
  assert.ok(text.includes('send_chat_message'));
  assert.ok(text.includes('drop_image'));
  assert.equal(text.includes(session.playerToken), false);
  assert.equal(text.includes('"type":"message"'), false);
});

test('a saved room session is restored without confusing an invitation with identity', () => {
  assert.deepEqual(parseSession(JSON.stringify(session)), session);
  for (const value of [null, '', '{', 'null', '[]', '{}', JSON.stringify({ roomId: 'id', inviteToken: 'invite' })]) {
    assert.equal(parseSession(value), null);
  }
});

test('late polling responses cannot replace another room or roll back the displayed revision', () => {
  assert.equal(shouldAcceptRoom(session.roomId, { id: session.roomId, revision: 5 }, { id: session.roomId, revision: 4 }), false);
  assert.equal(shouldAcceptRoom(session.roomId, { id: session.roomId, revision: 5 }, { id: session.roomId, revision: 6 }), true);
  assert.equal(shouldAcceptRoom('new-room', null, { id: session.roomId, revision: 6 }), false);
  assert.equal(shouldAcceptRoom(session.roomId, null, { id: session.roomId, revision: 1 }), true);
});

test('errors tell a mobile player how to recover instead of exposing server internals', () => {
  assert.match(roomErrorMessage('ROOM_NOT_FOUND'), /重启|失效/);
  assert.match(roomErrorMessage('VERSION_CONFLICT'), /更新/);
  assert.match(roomErrorMessage('NETWORK_ERROR'), /连接/);
  assert.match(roomErrorMessage('INVALID_MESSAGE'), /500|消息/);
  assert.match(roomErrorMessage('ROOM_NOT_FINISHED'), /结束|对局/);
  assert.equal(roomErrorMessage('private stack trace'), '操作没有完成，请稍后再试。');
});
