# 五子棋与通用聊天 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在大厅加入 15×15 五子棋，并把聊天变成房间级通用能力：边下边聊、聊天记录跨重开保留、双方确认再来一局。

**Architecture:** 聊天存在房间层（`Room.chat`），与游戏 `state` 分离；`version` 只随游戏动作/加入/重开变化，`revision` 随所有房间变化递增。五子棋作为独立 game adapter，通过 `initialState(players)` 分配黑白、`restart` 交换黑白。MCP 与 REST 共用同一个 `RoomStore`。

**Tech Stack:** TypeScript strict、Node 24 原生 TS、Express 5、Zod 4、MCP SDK、Vue 3 + Vite 8、原生 CSS/SVG。

**Spec:** `docs/superpowers/specs/2026-11-10-gomoku-chat-design.md`

## Global Constraints

- Node.js >= 24；不新增任何依赖。
- 聊天文本去首尾空白后 1–500 字符；房间只保留最近 200 条。
- `version`：创建 1；加入、游戏动作、重开成功 +1。`expectedVersion` 只与它比较。
- `revision`：创建 1；加入、聊天、游戏动作、重开投票、重开成功 +1。前端快照比较用它。
- 聊天不改变 `version`，不需要 `expectedVersion`。
- 五子棋 15×15、无禁手、创建者执黑、黑先、五连或下满结束、重开黑白互换。
- 纯聊天房间（sandbox）没有 `actionSchema` / `applyAction`，`submit_action` 返回 `INVALID_ACTION`。
- 保留现有 JSON 错误信封、Origin 校验、无 CORS、64kb body 限制；不新增安全层。
- 移动端验收尺寸：390×844、320×568、1440×1000。
- 不自动执行 git commit；每个任务结束只跑验证命令，提交由用户决定。

---

### Task 1: 扩展游戏接口并加入五子棋 adapter

**Files:**
- Modify: `src/game.ts`
- Create: `src/games/gomoku.ts`
- Modify: `src/index.ts:27`
- Create: `test/gomoku.test.ts`

**Interfaces:**
- Consumes: 现有 `JsonObject`、`RoomError`。
- Produces:
  - `Player.avatarUrl?: string`
  - `GameDefinition.initialState(players: Player[]): JsonObject`
  - `GameDefinition.restart?(players, previousState): JsonObject`
  - `GameDefinition.actionSchema?` 与 `applyAction?` 变为可选
  - `gomokuGame: GameDefinition`

- [ ] **Step 1: 写五子棋失败测试**

创建 `test/gomoku.test.ts`：

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gomokuGame } from '../src/games/gomoku.ts';
import type { GameContext, JsonObject, Player } from '../src/game.ts';

const players: Player[] = [
  { id: 'black-player', name: 'Black' },
  { id: 'white-player', name: 'White' },
];
const black: GameContext = { playerId: 'black-player', players };
const white: GameContext = { playerId: 'white-player', players };

function setup() {
  let state = gomokuGame.initialState(players);
  return {
    place(context: GameContext, row: number, col: number) {
      const result = gomokuGame.applyAction!(state, context, { type: 'place', row, col });
      state = result.state;
      return result;
    },
    state: () => state,
  };
}

function winSequence(moves: [number, number][]) {
  const game = setup();
  const replies: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3]];
  for (const [index, move] of moves.entries()) {
    game.place(black, move[0], move[1]);
    const reply = replies[index];
    if (reply) game.place(white, reply[0], reply[1]);
  }
  return game;
}

test('gomoku starts empty with the creator as black and black to move', () => {
  const state = gomokuGame.initialState(players) as JsonObject & {
    board: unknown[][]; blackPlayerId: string; whitePlayerId: string; turn: string;
  };
  assert.equal(state.board.length, 15);
  assert.equal(state.board.flat().filter(Boolean).length, 0);
  assert.equal(state.blackPlayerId, 'black-player');
  assert.equal(state.whitePlayerId, 'white-player');
  assert.equal(state.turn, 'black');
  assert.deepEqual(
    gomokuGame.getPlayerView(state, white),
    { ...state, yourColor: 'white' },
  );
});

test('gomoku rejects out-of-turn and occupied moves', () => {
  const game = setup();
  game.place(black, 7, 7);
  assert.throws(() => game.place(black, 7, 8), { code: 'INVALID_ACTION' });
  assert.throws(() => game.place(white, 7, 7), { code: 'INVALID_ACTION' });
  assert.throws(() => game.place(white, 15, 0), { code: 'INVALID_ACTION' });
  assert.equal(game.place(white, 8, 8).finished, false);
});

test('gomoku detects horizontal five and reports the winning cells', () => {
  const game = winSequence([[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]]);
  const result = (game.state() as { result: { winnerColor: string; winningCells: [number, number][] } }).result;
  assert.equal(result.winnerColor, 'black');
  assert.equal(result.winningCells.length, 5);
});

test('gomoku detects vertical and both diagonal fives', () => {
  const vertical = winSequence([[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]]);
  assert.equal((vertical.state() as { result: { winnerColor: string } }).result.winnerColor, 'black');
  const downRight = winSequence([[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  assert.equal((downRight.state() as { result: { winnerColor: string } }).result.winnerColor, 'black');
  const downLeft = winSequence([[7, 3], [6, 4], [5, 5], [4, 6], [3, 7]]);
  assert.equal((downLeft.state() as { result: { winnerColor: string } }).result.winnerColor, 'black');
});

test('gomoku draws when the board is full without five in a row', () => {
  const game = setup();
  const blackCells: [number, number][] = [];
  const whiteCells: [number, number][] = [];
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      ((row + 2 * col) % 4 < 2 ? blackCells : whiteCells).push([row, col]);
    }
  }
  assert.equal(blackCells.length, 113);
  assert.equal(whiteCells.length, 112);
  let last = game.place(black, ...blackCells[0]!);
  for (let index = 1; index < blackCells.length; index += 1) {
    game.place(white, ...whiteCells[index - 1]!);
    last = game.place(black, ...blackCells[index]!);
  }
  assert.equal(last.finished, true);
  assert.deepEqual((game.state() as { result: unknown }).result, { draw: true });
});

test('gomoku restart clears the board and swaps colors', () => {
  const game = setup();
  game.place(black, 7, 7);
  game.place(white, 8, 8);
  const restarted = gomokuGame.restart!(players, game.state()) as JsonObject & {
    board: unknown[][]; blackPlayerId: string; whitePlayerId: string; turn: string;
  };
  assert.equal(restarted.blackPlayerId, 'white-player');
  assert.equal(restarted.whitePlayerId, 'black-player');
  assert.equal(restarted.turn, 'black');
  assert.equal(restarted.board.flat().filter(Boolean).length, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/gomoku.test.ts`
Expected: FAIL，提示找不到 `../src/games/gomoku.ts`。

- [ ] **Step 3: 扩展 `GameDefinition`**

`src/game.ts` 改为：

```ts
import type { ZodType } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type Player = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type GameContext = {
  playerId: string;
  players: Player[];
};

export interface GameDefinition {
  id: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema?: ZodType<JsonObject>;
  initialState(players: Player[]): JsonObject;
  restart?(players: Player[], previousState: JsonObject): JsonObject;
  getPlayerView(state: JsonObject, context: GameContext): JsonObject;
  applyAction?(state: JsonObject, context: GameContext, action: JsonObject): {
    state: JsonObject;
    finished: boolean;
  };
}
```

现有 `sandboxGame` 的 `initialState: () => ...` 和测试里的 `initialState: () => ...` 仍然兼容，不需要改。

- [ ] **Step 4: 实现 `src/games/gomoku.ts`**

```ts
import * as z from 'zod';
import { RoomError } from '../errors.ts';
import type { GameDefinition, JsonObject, Player } from '../game.ts';

const SIZE = 15;
type Stone = 'black' | 'white';

type GomokuState = {
  board: (Stone | null)[][];
  blackPlayerId: string;
  whitePlayerId: string;
  turn: Stone;
  lastMove: { row: number; col: number; color: Stone } | null;
  moveCount: number;
  result:
    | { winnerColor: Stone; winningCells: [number, number][] }
    | { draw: true }
    | null;
};

function emptyBoard(): (Stone | null)[][] {
  return Array.from({ length: SIZE }, () => Array<Stone | null>(SIZE).fill(null));
}

function createState(black: Player, white: Player): GomokuState {
  return {
    board: emptyBoard(),
    blackPlayerId: black.id,
    whitePlayerId: white.id,
    turn: 'black',
    lastMove: null,
    moveCount: 0,
    result: null,
  };
}

function stateOf(value: JsonObject): GomokuState {
  return value as unknown as GomokuState;
}

function other(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black';
}

function findWinningCells(
  board: (Stone | null)[][],
  row: number,
  col: number,
  color: Stone,
): [number, number][] | null {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    const cells: [number, number][] = [[row, col]];
    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r]?.[c] === color) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 5) {
      return cells.sort(([ar, ac], [br, bc]) => ar - br || ac - bc);
    }
  }
  return null;
}

export const gomokuGame: GameDefinition = {
  id: 'gomoku',
  title: '五子棋',
  description: '15×15 无禁手五子棋。创建者执黑先行，双方轮流落子，先连成五子者获胜。',
  minPlayers: 2,
  maxPlayers: 2,
  actionSchema: z.strictObject({
    type: z.literal('place'),
    row: z.number().int().min(0).max(SIZE - 1),
    col: z.number().int().min(0).max(SIZE - 1),
  }),
  initialState: (players) => {
    const black = players[0];
    if (!black) throw new Error('Gomoku needs a creator.');
    const white = players[1] ?? { id: '', name: '' };
    return createState(black, white) as unknown as JsonObject;
  },
  restart: (players, previousState) => {
    const previous = stateOf(previousState);
    const black = players.find((player) => player.id === previous.whitePlayerId) ?? players[0];
    const white = players.find((player) => player.id === previous.blackPlayerId) ?? players[1];
    if (!black || !white) throw new Error('Gomoku needs two players.');
    return createState(black, white) as unknown as JsonObject;
  },
  getPlayerView: (state, context) => {
    const current = stateOf(state);
    const yourColor = context.playerId === current.blackPlayerId ? 'black' : 'white';
    return { ...current, yourColor } as unknown as JsonObject;
  },
  applyAction: (state, context, action) => {
    const current = stateOf(state);
    if (current.result) throw new RoomError('INVALID_ACTION', 'This game has ended.');
    const color: Stone | null = context.playerId === current.blackPlayerId
      ? 'black'
      : context.playerId === current.whitePlayerId ? 'white' : null;
    if (!color) throw new RoomError('INVALID_ACTION', 'You are not seated in this game.');
    if (color !== current.turn) throw new RoomError('INVALID_ACTION', 'Wait for your turn.');
    const row = action.row;
    const col = action.col;
    if (typeof row !== 'number' || typeof col !== 'number' ||
        !Number.isInteger(row) || !Number.isInteger(col) ||
        row < 0 || row >= SIZE || col < 0 || col >= SIZE) {
      throw new RoomError('INVALID_ACTION', 'Place a stone on the board.');
    }
    if (current.board[row]?.[col] !== null) {
      throw new RoomError('INVALID_ACTION', 'That point is already occupied.');
    }
    const board = current.board.map((line) => [...line]);
    board[row]![col] = color;
    const moveCount = current.moveCount + 1;
    const winning = findWinningCells(board, row, col, color);
    const result = winning
      ? { winnerColor: color, winningCells: winning }
      : moveCount === SIZE * SIZE ? { draw: true as const } : null;
    const next: GomokuState = {
      ...current,
      board,
      turn: other(color),
      lastMove: { row, col, color },
      moveCount,
      result,
    };
    return { state: next as unknown as JsonObject, finished: result !== null };
  },
};
```

- [ ] **Step 5: 注册五子棋**

`src/index.ts` 中：

```ts
import { gomokuGame } from './games/gomoku.ts';
import { sandboxGame } from './games/sandbox.ts';
```

并把：

```ts
const app = createApp({ authToken, store: new RoomStore([sandboxGame]), webHosts });
```

改为：

```ts
const app = createApp({ authToken, store: new RoomStore([gomokuGame, sandboxGame]), webHosts });
```

- [ ] **Step 6: 跑测试**

Run: `node --test test/gomoku.test.ts`
Expected: 6 tests pass。

Run: `npm test`
Expected: 全部通过（现有 sandbox 行为尚未改变）。

---

### Task 2: 房间级聊天、revision、头像与重开

**Files:**
- Modify: `src/errors.ts`
- Modify: `src/rooms.ts`
- Create: `test/chat.test.ts`

**Interfaces:**
- Consumes: Task 1 的可选 `actionSchema` / `applyAction` / `restart`、`initialState(players)`。
- Produces:
  - `RoomView.revision: number`
  - `RoomView.chat: ChatMessage[]`
  - `RoomView.rematchVotes: string[]`
  - `RoomStore.sendChat(input: { roomId; playerToken; text }): RoomView`
  - `RoomStore.requestRematch(input: { roomId; playerToken }): RoomView`
  - `createRoom` / `joinRoom` 接受可选 `avatarUrl`
  - `CHAT_LIMIT = 200`、`CHAT_TEXT_LIMIT = 500`
  - 错误码 `INVALID_MESSAGE`、`ROOM_NOT_FINISHED`

- [ ] **Step 1: 写房间层失败测试**

创建 `test/chat.test.ts`：

```ts
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

test('a finished room restarts only after every player requests it and keeps chat', () => {
  const { store, host, guest } = setup(finishGame);
  store.sendChat({ roomId: host.room.id, playerToken: host.playerToken, text: 'good game' });
  const finished = store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: guest.room.version, action: { type: 'finish' },
  });
  assert.equal(finished.status, 'finished');
  const first = store.requestRematch({ roomId: host.room.id, playerToken: host.playerToken });
  assert.deepEqual(first.rematchVotes, [host.room.selfPlayerId]);
  const repeated = store.requestRematch({ roomId: host.room.id, playerToken: host.playerToken });
  assert.deepEqual(repeated.rematchVotes, [host.room.selfPlayerId]);
  assert.equal(repeated.revision, first.revision);
  const restarted = store.requestRematch({ roomId: host.room.id, playerToken: guest.playerToken });
  assert.equal(restarted.status, 'active');
  assert.deepEqual(restarted.rematchVotes, []);
  assert.equal(restarted.version, finished.version + 1);
  assert.equal(restarted.state.restarted, true);
  assert.equal(restarted.chat.length, 1);
  assert.equal(restarted.chat[0]!.text, 'good game');
});

test('rematch is rejected before the game finishes', () => {
  const { store, host } = setup(finishGame);
  assert.throws(() => store.requestRematch({
    roomId: host.room.id, playerToken: host.playerToken,
  }), { code: 'ROOM_NOT_FINISHED' });
});

test('gomoku assigns creator black only when the room becomes active', () => {
  const store = new RoomStore([gomokuGame]);
  const host = store.createRoom({ gameId: 'gomoku', playerName: 'Human' });
  const guest = store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.equal(guest.room.state.yourColor, 'white');
  assert.equal(host.room.selfPlayerId, (guest.room.state as { blackPlayerId: string }).blackPlayerId);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/chat.test.ts`
Expected: FAIL，`sendChat` / `requestRematch` 不存在，`RoomView` 没有 `revision`。

- [ ] **Step 3: 新增错误码**

`src/errors.ts` 的 `RoomErrorCode` 增加：

```ts
  | 'INVALID_MESSAGE'
  | 'ROOM_NOT_FINISHED';
```

- [ ] **Step 4: 修改 `src/rooms.ts`**

在文件顶部增加：

```ts
export const CHAT_LIMIT = 200;
export const CHAT_TEXT_LIMIT = 500;

export type ChatMessage = {
  id: string;
  playerId: string;
  text: string;
  at: string;
};
```

`RoomView` 改为：

```ts
export type RoomView = {
  id: string;
  gameId: string;
  status: 'waiting' | 'active' | 'finished';
  version: number;
  revision: number;
  players: Player[];
  selfPlayerId: string;
  state: JsonObject;
  chat: ChatMessage[];
  rematchVotes: string[];
};
```

`Room` 增加：

```ts
  revision: number;
  chat: ChatMessage[];
  rematchVotes: Set<string>;
```

增加 helper：

```ts
function normalizeAvatar(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
```

`listGames` 中：

```ts
actionSchema: game.actionSchema ? z.toJSONSchema(game.actionSchema) : null,
```

`createRoom` 签名改为：

```ts
createRoom(input: { gameId: string; playerName: string; avatarUrl?: string }) {
```

玩家构造：

```ts
const avatarUrl = normalizeAvatar(input.avatarUrl);
const player: Player = {
  id: randomUUID(),
  name: input.playerName,
  ...(avatarUrl ? { avatarUrl } : {}),
};
```

房间构造增加：

```ts
revision: 1,
chat: [],
rematchVotes: new Set(),
state: game.initialState([player]),
```

`joinRoom` 签名改为：

```ts
joinRoom(input: { roomId: string; inviteToken: string; playerName: string; avatarUrl?: string }) {
```

玩家与状态：

```ts
const avatarUrl = normalizeAvatar(input.avatarUrl);
const player: Player = {
  id: randomUUID(),
  name: input.playerName,
  ...(avatarUrl ? { avatarUrl } : {}),
};
const players = [...room.players, player];
const state = room.status === 'waiting' && players.length >= room.game.minPlayers
  ? room.game.initialState(players)
  : room.state;
```

`nextRoom` 改为：

```ts
const nextRoom: Room = {
  ...room,
  players,
  credentials: new Map([...room.credentials, [playerToken, player.id]]),
  status: players.length >= room.game.minPlayers ? 'active' : 'waiting',
  version: room.version + 1,
  revision: room.revision + 1,
  state,
};
```

`submitAction` 在版本检查之后增加：

```ts
if (!room.game.actionSchema || !room.game.applyAction) {
  throw new RoomError('INVALID_ACTION', 'This room is chat-only. Use send_chat_message instead.');
}
```

动作成功后的 `nextRoom` 增加 `revision: room.revision + 1`。

新增方法：

```ts
sendChat(input: PlayerAccess & { text: string }): RoomView {
  const { room, playerId } = this.authenticate(input);
  const text = input.text.trim();
  if (!text || text.length > CHAT_TEXT_LIMIT) {
    throw new RoomError('INVALID_MESSAGE', 'Chat messages must be 1–500 characters.');
  }
  const chat = [
    ...room.chat,
    { id: randomUUID(), playerId, text, at: new Date().toISOString() },
  ].slice(-CHAT_LIMIT);
  const nextRoom: Room = { ...room, chat, revision: room.revision + 1 };
  const view = this.view(nextRoom, playerId);
  this.rooms.set(room.id, nextRoom);
  return view;
}

requestRematch(input: PlayerAccess): RoomView {
  const { room, playerId } = this.authenticate(input);
  if (room.status !== 'finished') {
    throw new RoomError('ROOM_NOT_FINISHED', 'Finish the current game before requesting a rematch.');
  }
  if (room.rematchVotes.has(playerId)) return this.view(room, playerId);
  const votes = new Set([...room.rematchVotes, playerId]);
  const everyoneVoted = votes.size >= room.players.length;
  const nextRoom: Room = everyoneVoted
    ? {
        ...room,
        state: room.game.restart?.(
          structuredClone(room.players),
          structuredClone(room.state),
        ) ?? room.game.initialState(structuredClone(room.players)),
        status: 'active',
        version: room.version + 1,
        revision: room.revision + 1,
        rematchVotes: new Set(),
      }
    : { ...room, revision: room.revision + 1, rematchVotes: votes };
  const view = this.view(nextRoom, playerId);
  this.rooms.set(room.id, nextRoom);
  return view;
}
```

`view` 返回增加：

```ts
revision: room.revision,
chat: structuredClone(room.chat),
rematchVotes: [...room.rematchVotes],
```

- [ ] **Step 5: 跑房间层测试**

Run: `node --test test/chat.test.ts`
Expected: 8 tests pass。

Run: `npm test`
Expected: 全部通过。sandbox 此时仍有 `message` 动作，现有测试不受影响。

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: pass。

---

### Task 3: MCP 聊天、重开与头像

**Files:**
- Modify: `src/mcp.ts`
- Modify: `test/mcp.test.ts`
- Modify: `test/startup.test.ts:37`

**Interfaces:**
- Consumes: `RoomStore.sendChat`、`RoomStore.requestRematch`、`avatarUrl`。
- Produces: MCP 工具 `send_chat_message`、`request_rematch`；`create_room` / `join_room` 的 `avatarUrl`。

- [ ] **Step 1: 写 MCP 失败测试**

在 `test/mcp.test.ts` 增加：

```ts
import * as z from 'zod';
import { gomokuGame } from '../src/games/gomoku.ts';
import type { GameDefinition, JsonObject } from '../src/game.ts';

const finishGame: GameDefinition = {
  id: 'finish-test', title: 'Finish test', description: 'Fixture',
  minPlayers: 2, maxPlayers: 2,
  actionSchema: z.strictObject({ type: z.literal('finish') }),
  initialState: () => ({ done: false }),
  getPlayerView: (state) => state,
  applyAction: () => ({ state: { done: true }, finished: true }),
  restart: () => ({ done: false, restarted: true }),
};
```

并让默认 store 包含五子棋：

```ts
async function setup(t: TestContext, store = new RoomStore([sandboxGame, gomokuGame])) {
```

把工具列表断言改为：

```ts
assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
  'create_room', 'get_room', 'join_room', 'list_games',
  'request_rematch', 'send_chat_message', 'submit_action',
]);
```

新增测试：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/mcp.test.ts`
Expected: FAIL，工具列表缺少新工具。

- [ ] **Step 3: 修改 `src/mcp.ts`**

增加：

```ts
const avatarUrl = z.string().trim().max(500).optional().describe('Optional public image URL for your avatar.');
const chatText = z.string().trim().min(1).max(500).describe('Room chat message. Visible to both players.');
```

`create_room` 的 inputSchema 改为：

```ts
inputSchema: z.strictObject({
  gameId: z.string().min(1).max(64),
  playerName,
  avatarUrl,
}),
```

`join_room` 的 inputSchema 增加：

```ts
avatarUrl,
```

新增两个工具：

```ts
server.registerTool('send_chat_message', {
  title: 'Send a chat message',
  description: 'Send a room-level chat message. Available in every game; it does not change the game version and needs no expectedVersion.',
  inputSchema: z.strictObject({ roomId, playerToken, text: chatText }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, (input) => result(() => store.sendChat(input)));

server.registerTool('request_rematch', {
  title: 'Request a rematch',
  description: 'After a finished game, request another round. Both players must request before the room restarts.',
  inputSchema: z.strictObject({ roomId, playerToken }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, (input) => result(() => store.requestRematch(input)));
```

更新 `instructions` 中与聊天、重开有关的内容，至少包含：

```ts
'Chat is a room-level capability in every game. Use send_chat_message; submit_action is only for game actions.',
'After a game finishes, either player may call request_rematch. The game restarts only after every player has requested it.',
```

把 `list_games` 的描述改为：

```ts
description: 'Discover available games, player limits, rules and JSON action schemas before creating a room. actionSchema is null for chat-only rooms.',
```

- [ ] **Step 4: 更新启动测试**

`test/startup.test.ts` 中：

```ts
assert.equal((await client.listTools()).tools.length, 7);
```

- [ ] **Step 5: 跑测试**

Run: `node --test test/mcp.test.ts test/startup.test.ts`
Expected: pass。

Run: `npm test`
Expected: 全部通过。

---

### Task 4: Web API 聊天、重开与头像

**Files:**
- Modify: `src/web-api.ts`
- Modify: `test/web-api.test.ts`

**Interfaces:**
- Consumes: Task 2 的 store 方法。
- Produces:
  - `POST /api/rooms/:roomId/chat`
  - `POST /api/rooms/:roomId/rematch`
  - create/join 接受 `avatarUrl`
  - `INVALID_MESSAGE` → 400，`ROOM_NOT_FINISHED` → 409

- [ ] **Step 1: 写 Web API 失败测试**

在 `test/web-api.test.ts` 增加：

```ts
test('web and MCP chat share the same room and never change the game version', async (t) => {
  const { base, create, post } = await setup(t);
  const host = await create();
  const client = new Client({ name: 'chat-agent', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
  }));
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
  const { post, base } = await setup(t, store);
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
```

`test/web-api.test.ts` 顶部补：

```ts
import * as z from 'zod';
import type { GameDefinition } from '../src/game.ts';
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/web-api.test.ts`
Expected: FAIL，聊天/重开路由 404。

- [ ] **Step 3: 修改 `src/web-api.ts`**

增加 schema：

```ts
const avatarUrlSchema = z.string().trim().max(500).optional();
const chatSchema = z.strictObject({ text: z.string().max(500) });
```

`createSchema` 与 `joinSchema` 增加：

```ts
avatarUrl: avatarUrlSchema,
```

`roomStatus` 增加：

```ts
INVALID_MESSAGE: 400,
ROOM_NOT_FINISHED: 409,
```

新增路由（放在 actions 路由之后）：

```ts
router.post('/rooms/:roomId/chat', requireJson, ...jsonBody, (req, res) => {
  const roomId = parseRoomId(req.params.roomId);
  const playerToken = bearer(req);
  const body = parse(chatSchema, req.body);
  res.json(store.sendChat({ roomId, playerToken, text: body.text }));
});

router.post('/rooms/:roomId/rematch', (req, res) => {
  res.json(store.requestRematch({
    roomId: parseRoomId(req.params.roomId),
    playerToken: bearer(req),
  }));
});
```

- [ ] **Step 4: 跑测试**

Run: `node --test test/web-api.test.ts`
Expected: pass（新增 3 个测试，原有测试仍绿）。

Run: `npm test`
Expected: 全部通过。

---

### Task 5: 把默契试验场改为纯聊天，并迁移受影响的测试

**Files:**
- Modify: `src/games/sandbox.ts`
- Modify: `test/rooms.test.ts`
- Modify: `test/mcp.test.ts`
- Modify: `test/web-api.test.ts`
- Modify: `test/web-startup.test.ts:37`

**Interfaces:**
- Consumes: Task 2 的 chat-only 分支、Task 3/4 的新工具与路由。
- Produces: `sandboxGame` 只有 `initialState` / `getPlayerView`，没有动作。

- [ ] **Step 1: 改 `src/games/sandbox.ts`**

```ts
import type { GameDefinition } from '../game.ts';

export const sandboxGame: GameDefinition = {
  id: 'sandbox',
  title: '默契试验场',
  description: 'Two-player chat room. Say hello, find some chemistry, and keep talking. No turns, actions or win condition. Only the latest 200 messages are kept.',
  minPlayers: 2,
  maxPlayers: 2,
  initialState: () => ({}),
  getPlayerView: (state) => state,
};
```

- [ ] **Step 2: 让 `test/rooms.test.ts` 继续覆盖动作语义**

在测试文件内新增一个 fixture，保留原来的消息动作：

```ts
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
```

把 `setup()` 改为使用它：

```ts
function setup() {
  const store = new RoomStore([actionGame]);
  const host = store.createRoom({ gameId: actionGame.id, playerName: 'Human' });
  return { store, host };
}
```

所有把 `sandboxGame` 展开成 fixture 的测试改为展开 `actionGame`：

```ts
const game: GameDefinition = { ...actionGame, applyAction: ... };
```

`game adapters project private views...` 与 `sandbox history stays bounded...` 的语义保持不变，只把 store/game 换成动作 fixture。`sandbox history stays bounded` 改名为：

```ts
test('action history stays bounded while accepting later messages', ...)
```

并在文件末尾新增：

```ts
test('sandbox is chat-only and cannot accept game actions', () => {
  const store = new RoomStore([sandboxGame]);
  const host = store.createRoom({ gameId: 'sandbox', playerName: 'Human' });
  store.joinRoom({ roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent' });
  assert.throws(() => store.submitAction({
    roomId: host.room.id, playerToken: host.playerToken,
    expectedVersion: 2, action: { type: 'message', text: 'legacy' },
  }), { code: 'INVALID_ACTION' });
});
```

- [ ] **Step 3: 更新 MCP 测试**

`test/mcp.test.ts` 的 `MCP advertises...` 改为：

```ts
const { games } = await call<{ games: { id: string; actionSchema: { required: string[] } | null }[] }>(client, 'list_games');
const sandbox = games.find((game) => game.id === 'sandbox');
const gomoku = games.find((game) => game.id === 'gomoku');
assert.equal(sandbox?.actionSchema, null);
assert.deepEqual(gomoku?.actionSchema?.required, ['type', 'row', 'col']);
```

`two independent HTTP MCP clients share a complete room/action flow` 改为聊天流程：

```ts
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
```

`internal adapter exceptions...` 的 fixture 需要补 `actionSchema`，否则会先被 chat-only 拦住：

```ts
const store = new RoomStore([{
  ...sandboxGame,
  id: 'sandbox',
  actionSchema: z.strictObject({ type: z.literal('message'), text: z.string() }),
  applyAction: () => { throw new Error('private-server-secret'); },
}]);
```

提交动作改为：

```ts
action: { type: 'message', text: 'trigger' },
```

`MCP domain errors...` 中的 stale/unknown 动作仍会按预期返回 `VERSION_CONFLICT` / `INVALID_ACTION`，不需要改。

- [ ] **Step 4: 更新 Web API 测试**

`web games and MCP actions share the same room...` 改为聊天：

```ts
test('web games and MCP chat share the same room without exposing the server credential', async (t) => {
  const { base, create, post } = await setup(t);
  const games = await fetch(`${base}/api/games`);
  assert.equal(games.status, 200);
  assert.equal(games.headers.get('cache-control'), 'no-store');
  assert.equal((await games.json()).games[0].id, 'sandbox');
  const host = await create();
  const client = new Client({ name: 'web-integration-agent', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${authToken}` } },
  }));
  const joined = await client.callTool({ name: 'join_room', arguments: {
    roomId: host.room.id, inviteToken: host.inviteToken, playerName: 'Agent',
  } });
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
  assert.deepEqual(room.chat.map((message) => message.text), ['Hello from the browser', 'Hello from MCP']);
  assert.equal(JSON.stringify(room).includes(guest.playerToken), false);
});
```

`web validation...` 中等待状态的动作断言仍返回 `ROOM_NOT_READY`；把加入后的动作断言改为：

```ts
await assertError(await post(`/rooms/${host.room.id}/actions`, {
  expectedVersion: 2, action: { type: 'message', text: ' ' },
}, host.playerToken), 400, 'INVALID_ACTION');
```

因为 sandbox 是 chat-only，`INVALID_ACTION` 仍然成立。若想覆盖五子棋 schema，可再建一个 gomoku 房间，但本任务不强制。

`web domain errors...` 的 stale 动作仍返回 `VERSION_CONFLICT`，不需要改。

- [ ] **Step 5: 更新启动测试**

`test/web-startup.test.ts`：

```ts
const games = await (await fetch(`${origin}/api/games`)).json() as { games: { id: string }[] };
assert.equal(games.games[0]?.id, 'gomoku');
```

- [ ] **Step 6: 跑测试**

Run: `npm test`
Expected: 全部通过。

Run: `npm run typecheck`
Expected: pass。

---

### Task 6: 前端数据层与 sandbox 聊天迁移

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/lib/api.ts`
- Modify: `web/lib/session.ts`
- Modify: `web/lib/usePlayground.ts`
- Modify: `web/components/RoomPage.vue`
- Modify: `web/App.vue`
- Modify: `test/frontend-session.test.ts`

**Interfaces:**
- Consumes: Task 4 的 chat/rematch 路由、Task 5 的 chat-only sandbox。
- Produces:
  - `api.chat(session, text)`
  - `api.action(session, expectedVersion, action)`
  - `api.rematch(session)`
  - `usePlayground().sendChat`、`place`、`requestRematch`
  - `shouldAcceptRoom` 比较 `revision`
  - 新邀请指令

- [ ] **Step 1: 更新前端 session 测试**

`test/frontend-session.test.ts`：

```ts
test('the agent invitation shares the invitation and room but never the player credential', () => {
  const text = buildInvitation(session);
  assert.ok(text.includes(session.roomId));
  assert.ok(text.includes(session.inviteToken));
  assert.ok(text.includes('join_room'));
  assert.ok(text.includes('send_chat_message'));
  assert.equal(text.includes(session.playerToken), false);
  assert.equal(text.includes('"type":"message"'), false);
});

test('late polling responses cannot replace another room or roll back the displayed revision', () => {
  assert.equal(shouldAcceptRoom(session.roomId, { id: session.roomId, revision: 5 }, { id: session.roomId, revision: 4 }), false);
  assert.equal(shouldAcceptRoom(session.roomId, { id: session.roomId, revision: 5 }, { id: session.roomId, revision: 6 }), true);
  assert.equal(shouldAcceptRoom('new-room', null, { id: session.roomId, revision: 6 }), false);
  assert.equal(shouldAcceptRoom(session.roomId, null, { id: session.roomId, revision: 1 }), true);
});
```

错误信息断言增加：

```ts
assert.match(roomErrorMessage('INVALID_MESSAGE'), /500|消息/);
assert.match(roomErrorMessage('ROOM_NOT_FINISHED'), /结束|对局/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/frontend-session.test.ts`
Expected: FAIL，邀请文本仍是旧内容，`shouldAcceptRoom` 仍看 version。

- [ ] **Step 3: 修改 `web/lib/session.ts`**

`shouldAcceptRoom` 改为：

```ts
export function shouldAcceptRoom(
  sessionRoomId: string,
  current: { id: string; revision: number } | null,
  next: { id: string; revision: number },
): boolean {
  return next.id === sessionRoomId &&
    (!current || current.id !== next.id || next.revision >= current.revision);
}
```

`buildInvitation` 改为：

```ts
export function buildInvitation(session: RoomSession): string {
  return [
    '来「同游」和我一起玩。请使用已配置的 play-with-ai MCP：',
    `1. 调用 join_room，roomId 为 ${session.roomId}，inviteToken 为 ${session.inviteToken ?? ''}，playerName 请使用你的名字。`,
    '2. 保存返回的私有 playerToken，不要分享；用 get_room 查看 gameId、局面和聊天。',
    '3. 调用 list_games，按 gameId 找到当前游戏和 actionSchema。',
    '4. 聊天用 send_chat_message；五子棋落子用 submit_action，以最新 version 作为 expectedVersion。',
    '5. 不要重复加入，也不要高速轮询；等我的指示再行动。',
  ].join('\n');
}
```

`roomErrorMessage` 增加：

```ts
INVALID_MESSAGE: '消息需要 1–500 个字符，请检查后再发送。',
ROOM_NOT_FINISHED: '当前对局还没有结束，结束后才能再来一局。',
```

并把 `ROOM_NOT_READY` 文案改为：

```ts
ROOM_NOT_READY: '还在等另一位玩家。可以先聊聊，加入后再开始对局。',
```

- [ ] **Step 4: 修改 `web/lib/types.ts`**

```ts
import type { ChatMessage, RoomStore, RoomView } from '../../src/rooms.ts';

export type { ChatMessage, RoomView };
export type GameInfo = ReturnType<RoomStore['listGames']>[number];
export type RoomCreated = ReturnType<RoomStore['createRoom']>;
export type Player = RoomView['players'][number];
export type Stone = 'black' | 'white';
export type GomokuView = {
  board: (Stone | null)[][];
  blackPlayerId: string;
  whitePlayerId: string;
  turn: Stone;
  lastMove: { row: number; col: number; color: Stone } | null;
  moveCount: number;
  result:
    | { winnerColor: Stone; winningCells: [number, number][] }
    | { draw: true }
    | null;
  yourColor: Stone;
};
export type RoomSession = {
  roomId: string;
  playerToken: string;
  inviteToken?: string;
  playerName: string;
};
```

- [ ] **Step 5: 修改 `web/lib/api.ts`**

```ts
createRoom: (gameId: string, playerName: string, avatarUrl?: string) => request<RoomCreated>('/rooms', {
  method: 'POST',
  body: { gameId, playerName, ...(avatarUrl ? { avatarUrl } : {}) },
}),
action: (session: RoomSession, expectedVersion: number, action: Record<string, unknown>) => request<RoomView>(
  `/rooms/${encodeURIComponent(session.roomId)}/actions`,
  { method: 'POST', playerToken: session.playerToken, body: { expectedVersion, action } },
),
chat: (session: RoomSession, text: string) => request<RoomView>(
  `/rooms/${encodeURIComponent(session.roomId)}/chat`,
  { method: 'POST', playerToken: session.playerToken, body: { text } },
),
rematch: (session: RoomSession) => request<RoomView>(
  `/rooms/${encodeURIComponent(session.roomId)}/rematch`,
  { method: 'POST', playerToken: session.playerToken },
),
```

删除原来的 `send` 方法。

- [ ] **Step 6: 修改 `web/lib/usePlayground.ts`**

`sendMessage` 改为：

```ts
async function sendChat(text: string): Promise<boolean> {
  if (!session.value || !room.value || sending.value) return false;
  const current = session.value;
  sending.value = true;
  sendError.value = '';
  try {
    const snapshot = await api.chat(current, text.trim());
    if (session.value !== current) return false;
    acceptRoom(snapshot);
    return true;
  } catch (error) {
    if (session.value !== current) return false;
    sendError.value = error instanceof ApiError && error.code === 'NETWORK_ERROR'
      ? '发送结果暂时无法确认。内容已保留，请恢复连接后查看记录，再决定是否重发。'
      : (error as Error).message;
    return false;
  } finally {
    sending.value = false;
  }
}

async function place(row: number, col: number): Promise<boolean> {
  if (!session.value || !room.value || sending.value) return false;
  const current = session.value;
  sending.value = true;
  sendError.value = '';
  try {
    const snapshot = await api.action(current, room.value.version, { type: 'place', row, col });
    if (session.value !== current) return false;
    acceptRoom(snapshot);
    return true;
  } catch (error) {
    if (session.value !== current) return false;
    sendError.value = error instanceof ApiError && error.code === 'NETWORK_ERROR'
      ? '落子结果暂时无法确认。请恢复连接后查看棋盘，再决定是否重试。'
      : (error as Error).message;
    if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') await refreshRoom();
    return false;
  } finally {
    sending.value = false;
  }
}

async function requestRematch(): Promise<boolean> {
  if (!session.value || !room.value || sending.value) return false;
  const current = session.value;
  sending.value = true;
  sendError.value = '';
  try {
    const snapshot = await api.rematch(current);
    if (session.value !== current) return false;
    acceptRoom(snapshot);
    return true;
  } catch (error) {
    if (session.value !== current) return false;
    sendError.value = (error as Error).message;
    return false;
  } finally {
    sending.value = false;
  }
}
```

返回对象改为：

```ts
return {
  games, gamesLoading, gamesError, session, room, page, roomLoading, roomError,
  sendError, storageNotice, expired, sending, creating, loadGames, refreshRoom,
  createRoom, sendChat, place, requestRematch,
};
```

`createRoom` 增加第三个参数：

```ts
async function createRoom(gameId: string, playerName: string, avatarUrl?: string) {
  ...
  const created = await api.createRoom(gameId, playerName.trim(), avatarUrl?.trim() || undefined);
```

- [ ] **Step 7: 迁移 `RoomPage.vue` 的 sandbox 聊天**

- props 中 `sendMessage` 改为 `sendChat`，并增加本次先由 App 传入、Task 7 才使用的两个回调：

```ts
sendChat: (text: string) => Promise<boolean>;
place: (row: number, col: number) => Promise<boolean>;
requestRematch: () => Promise<boolean>;
```

- `messages` 改为：

```ts
const messages = computed(() => props.room?.chat ?? []);
```

- 消息 key 改为 `message.id`。
- `canSend` 改为：

```ts
const canSend = computed(() => !props.expired && !props.sending && !!draft.value.trim());
```

- textarea 的禁用条件改为：

```html
:disabled="expired || sending"
```

- `placeholder` 改为：

```html
:placeholder="expired ? '房间已失效' : room?.status === 'waiting' ? '先留一句问候，等对方入座…' : '说点什么，边玩边聊…'"
```

- `maxlength` 改为 `500`，字数显示 `/ 500`。
- 滚动 watcher 改为：

```ts
watch(() => props.room?.revision, async () => { ... });
```

- `send()` 调用 `props.sendChat(draft.value.trim())`。
- 标题/状态文案按 `gameId` 显示；sandbox 保持“默契试验场”，gomoku 由 Task 7 处理。

- [ ] **Step 8: 更新 `App.vue`**

`usePlayground()` 解构改为：

```ts
const { ..., createRoom, sendChat, place, requestRematch } = usePlayground();
```

`RoomPage` 传参改为：

```html
:send-chat="sendChat"
:place="place"
:request-rematch="requestRematch"
```

`confirmCreate` 改为：

```ts
await createRoom(selectedGame.value.id, playerName.value, avatarUrl.value);
```

此时 `avatarUrl` 在 Task 8 加输入框；Task 6 可以先声明 `const avatarUrl = ref('')`，或先不传第三个参数。为了本任务可编译，增加：

```ts
const avatarUrl = ref('');
```

- [ ] **Step 9: 跑测试与类型检查**

Run: `node --test test/frontend-session.test.ts`
Expected: pass。

Run: `npm run typecheck`
Expected: pass（RoomPage 尚未有五子棋 UI，但 sandbox 已改用 `room.chat`）。

Run: `npm run build`
Expected: pass。

---

### Task 7: 五子棋房间 UI、头像、气泡与历史

**Files:**
- Create: `web/components/PlayerAvatar.vue`
- Create: `web/components/ChatComposer.vue`
- Create: `web/components/ChatHistory.vue`
- Create: `web/components/GomokuBoard.vue`
- Create: `web/components/GomokuRoom.vue`
- Modify: `web/components/RoomPage.vue`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: `RoomView`、`GomokuView`、`sendChat`、`place`、`requestRematch`。
- Produces: 五子棋房间布局、共用头像/输入框/历史组件。

- [ ] **Step 1: 创建 `PlayerAvatar.vue`**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { Player } from '../lib/types.ts';

const props = defineProps<{
  player?: Player;
  fallbackName?: string;
  ai?: boolean;
  small?: boolean;
}>();
const failed = ref(false);
watch(() => props.player?.avatarUrl, () => { failed.value = false; });
</script>

<template>
  <span class="player-avatar" :class="{ 'avatar-ai': ai, 'avatar-human': !ai, 'is-small': small }">
    <img v-if="player?.avatarUrl && !failed" :src="player.avatarUrl" :alt="`${player.name} 的头像`" @error="failed = true" />
    <AppIcon v-else-if="ai" name="spark" :size="small ? 17 : 22" />
    <span v-else class="avatar-letter">{{ (player?.name ?? fallbackName ?? '?').trim().slice(0, 1) }}</span>
  </span>
</template>
```

- [ ] **Step 2: 创建 `ChatComposer.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from './AppIcon.vue';

const model = defineModel<string>({ required: true });
const props = defineProps<{
  disabled: boolean;
  sending: boolean;
  placeholder: string;
}>();
const emit = defineEmits<{ send: [] }>();
const input = ref<HTMLTextAreaElement>();

function resize() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(input.value.scrollHeight, 128)}px`;
}
function onEnter(event: KeyboardEvent) {
  if (!event.isComposing && !('ontouchstart' in window)) {
    event.preventDefault();
    emit('send');
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="emit('send')">
    <div class="composer-box">
      <textarea
        id="message-draft" name="message" ref="input" v-model="model" rows="1" maxlength="500"
        :aria-label="placeholder" :placeholder="placeholder" :disabled="disabled"
        @input="resize" @keydown.enter.exact="onEnter"
      ></textarea>
      <button class="send-button" type="submit" :disabled="disabled || !model.trim() || sending" aria-label="发送消息">
        <span v-if="sending" class="spinner"></span>
        <AppIcon v-else name="send" :size="21" />
      </button>
    </div>
    <div class="composer-caption"><span>你的消息只在这个房间里可见</span><span>{{ model.length }} / 500</span></div>
  </form>
</template>
```

- [ ] **Step 3: 创建 `ChatHistory.vue`**

```vue
<script setup lang="ts">
import PlayerAvatar from './PlayerAvatar.vue';
import type { ChatMessage, RoomView } from '../lib/types.ts';

const props = defineProps<{ room: RoomView }>();

function player(playerId: string) {
  return props.room.players.find((item) => item.id === playerId);
}
function name(playerId: string) {
  return player(playerId)?.name ?? '玩家';
}
</script>

<template>
  <div class="chat-history" role="log" aria-label="对话记录">
    <p v-if="!room.chat.length" class="chat-history-empty">还没有消息，先从一句你好开始。</p>
    <article
      v-for="message in room.chat" :key="message.id"
      class="history-message" :class="{ self: message.playerId === room.selfPlayerId }"
    >
      <PlayerAvatar :player="player(message.playerId)" :ai="message.playerId !== room.selfPlayerId" small />
      <div class="history-body">
        <span class="history-name">{{ name(message.playerId) }}{{ message.playerId === room.selfPlayerId ? ' · 你' : '' }}</span>
        <p>{{ message.text }}</p>
      </div>
    </article>
  </div>
</template>
```

- [ ] **Step 4: 创建 `GomokuBoard.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { GomokuView } from '../lib/types.ts';

const SIZE = 15;
const props = defineProps<{
  board: GomokuView['board'];
  lastMove: GomokuView['lastMove'];
  winningCells: [number, number][] | null;
  disabled: boolean;
}>();
const emit = defineEmits<{ place: [row: number, col: number] }>();

const stars = [
  { row: 3, col: 3 }, { row: 3, col: 11 }, { row: 7, col: 7 },
  { row: 11, col: 3 }, { row: 11, col: 11 },
];
const stones = computed(() => {
  const list: { row: number; col: number; color: 'black' | 'white'; key: string }[] = [];
  props.board.forEach((line, row) => line.forEach((cell, col) => {
    if (cell) list.push({ row, col, color: cell, key: `${row}-${col}` });
  }));
  return list;
});
const winning = computed(() => new Set((props.winningCells ?? []).map(([row, col]) => `${row}-${col}`)));
const lastKey = computed(() => props.lastMove ? `${props.lastMove.row}-${props.lastMove.col}` : '');
function canPlace(row: number, col: number) {
  return !props.disabled && props.board[row]?.[col] === null;
}
</script>

<template>
  <div class="gomoku-board" aria-label="五子棋棋盘">
    <svg class="gomoku-grid" viewBox="-0.5 -0.5 15 15" aria-hidden="true">
      <line v-for="index in SIZE" :key="`h-${index}`" x1="0" :y1="index - 1" x2="14" :y2="index - 1" />
      <line v-for="index in SIZE" :key="`v-${index}`" :x1="index - 1" y1="0" :x2="index - 1" y2="14" />
      <circle v-for="star in stars" :key="`${star.row}-${star.col}`" :cx="star.col" :cy="star.row" r="0.09" class="star" />
      <circle
        v-for="stone in stones" :key="stone.key"
        :cx="stone.col" :cy="stone.row" r="0.42"
        :class="['stone', `stone-${stone.color}`, { winning: winning.has(stone.key) }]"
      />
      <circle v-if="lastMove" :cx="lastMove.col" :cy="lastMove.row" r="0.12" class="last-move" :class="`last-${lastMove.color}`" />
    </svg>
    <div class="gomoku-hits">
      <button
        v-for="index in SIZE * SIZE" :key="index" type="button" class="gomoku-hit"
        :disabled="!canPlace(Math.floor((index - 1) / SIZE), (index - 1) % SIZE)"
        :aria-label="`第 ${Math.floor((index - 1) / SIZE) + 1} 行第 ${(index - 1) % SIZE + 1} 列`"
        @click="emit('place', Math.floor((index - 1) / SIZE), (index - 1) % SIZE)"
      ></button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: 创建 `GomokuRoom.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
import ChatComposer from './ChatComposer.vue';
import ChatHistory from './ChatHistory.vue';
import GomokuBoard from './GomokuBoard.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import type { GomokuView, RoomSession, RoomView } from '../lib/types.ts';

const props = defineProps<{
  room: RoomView;
  session: RoomSession;
  error: string;
  sendError: string;
  sending: boolean;
  expired: boolean;
  sendChat: (text: string) => Promise<boolean>;
  place: (row: number, col: number) => Promise<boolean>;
  requestRematch: () => Promise<boolean>;
  invite: () => void;
}>();
const emit = defineEmits<{ retry: [] }>();
const draft = ref('');
const historyOpen = ref(false);
const state = computed(() => props.room.state as unknown as GomokuView);
const winningCells = computed(() => {
  const result = state.value.result;
  return result && 'winnerColor' in result ? result.winningCells : null;
});
const me = computed(() => props.room.players.find((player) => player.id === props.room.selfPlayerId));
const opponent = computed(() => props.room.players.find((player) => player.id !== props.room.selfPlayerId));
const lastMine = computed(() => [...props.room.chat].reverse().find((message) => message.playerId === props.room.selfPlayerId));
const lastOpponent = computed(() => [...props.room.chat].reverse().find((message) => message.playerId !== props.room.selfPlayerId));
const myColor = computed(() => state.value.yourColor);
const opponentColor = computed(() => myColor.value === 'black' ? 'white' : 'black');
const myTurn = computed(() => props.room.status === 'active' && !state.value.result && state.value.turn === myColor.value);
const boardDisabled = computed(() => props.expired || props.sending || !myTurn.value);
const voted = computed(() => props.room.rematchVotes.includes(props.room.selfPlayerId));
const resultText = computed(() => {
  const result = state.value.result;
  if (!result) return '';
  if ('draw' in result) return '平局';
  return result.winnerColor === myColor.value ? '你赢了' : '你输了';
});
const statusText = computed(() => {
  if (props.expired) return '房间已失效';
  if (props.error) return '连接中断';
  if (props.room.status === 'waiting') return '等待对手入座';
  if (state.value.result) return '对局结束，还能聊聊';
  return myTurn.value ? '轮到你落子' : '等对方落子';
});
const composerDisabled = computed(() => props.expired || props.sending);

async function send() {
  if (composerDisabled.value || !draft.value.trim()) return;
  if (await props.sendChat(draft.value.trim())) draft.value = '';
}
function place(row: number, col: number) {
  if (!myTurn.value || props.sending || props.expired) return;
  void props.place(row, col);
}
</script>

<template>
  <section class="gomoku-room" aria-label="五子棋房间">
    <div v-if="error" class="room-error" role="alert">
      <AppIcon name="info" :size="18" /><span>{{ error }}</span>
      <button v-if="!expired" class="text-button" @click="emit('retry')">重试</button>
    </div>

    <div class="gomoku-player gomoku-player-top">
      <PlayerAvatar :player="opponent" ai />
      <div class="gomoku-player-copy">
        <div class="gomoku-player-name">
          <strong>{{ opponent?.name ?? '留给你的 AI' }}</strong>
          <span v-if="opponent" class="stone-tag" :class="`stone-tag-${opponentColor}`"></span>
        </div>
        <p v-if="lastOpponent" class="chat-bubble">{{ lastOpponent.text }}</p>
        <p v-else class="chat-bubble chat-bubble-empty">{{ opponent ? '还没有消息' : '邀请你的 AI 来下棋' }}</p>
      </div>
      <button class="text-button history-button" @click="historyOpen = true">对话记录</button>
    </div>

    <div class="gomoku-stage">
      <div class="gomoku-status" :class="{ mine: myTurn }"><i></i>{{ statusText }}</div>
      <GomokuBoard
        :board="state.board" :last-move="state.lastMove"
        :winning-cells="winningCells"
        :disabled="boardDisabled" @place="place"
      />
      <div v-if="state.result" class="gomoku-result">
        <strong>{{ resultText }}</strong>
        <button class="button primary" :disabled="sending" @click="requestRematch">
          {{ voted ? '已请求，等对方' : '再来一局' }}
          <span class="rematch-count">{{ room.rematchVotes.length }} / 2</span>
        </button>
      </div>
    </div>

    <div class="gomoku-player gomoku-player-bottom">
      <PlayerAvatar :player="me" :fallback-name="session.playerName" />
      <div class="gomoku-player-copy">
        <div class="gomoku-player-name">
          <strong>{{ me?.name ?? session.playerName }}</strong>
          <span class="stone-tag" :class="`stone-tag-${myColor}`"></span>
          <span class="you-tag">你</span>
        </div>
        <p v-if="lastMine" class="chat-bubble chat-bubble-self">{{ lastMine.text }}</p>
        <p v-else class="chat-bubble chat-bubble-empty">{{ room.status === 'waiting' ? '先留一句话，等对方入座' : '边下边聊，说点什么' }}</p>
      </div>
    </div>

    <p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
    <ChatComposer
      v-model="draft" :disabled="composerDisabled" :sending="sending"
      :placeholder="room.status === 'waiting' ? '先留一句问候，等对方入座…' : '边下边聊，说点什么…'"
      @send="send"
    />
    <button v-if="!opponent && !expired && session.inviteToken" class="button secondary invite-inline" @click="invite">
      <AppIcon name="link" :size="17" /> 邀请我的 AI
    </button>

    <AppDialog v-if="historyOpen" title="对话记录" wide @close="historyOpen = false">
      <ChatHistory :room="room" />
    </AppDialog>
  </section>
</template>
```

- [ ] **Step 6: 修改 `RoomPage.vue` 接入分支**

在 `<script setup>` 中增加：

```ts
import GomokuRoom from './GomokuRoom.vue';
```

新增 computed：

```ts
const isGomoku = computed(() => props.room?.gameId === 'gomoku');
```

props 增加：

```ts
place: (row: number, col: number) => Promise<boolean>;
requestRematch: () => Promise<boolean>;
```

把 sandbox 的 `conversation-panel` 整体包进：

```html
<div v-if="!isGomoku" class="room-layout"> ... </div>
<GomokuRoom
  v-else-if="room"
  :room="room" :session="session" :error="error" :send-error="sendError"
  :sending="sending" :expired="expired" :send-chat="sendChat" :place="place"
  :request-rematch="requestRematch" :invite="() => emit('invite')"
  @retry="emit('retry')"
/>
<div v-else class="gomoku-loading"><span class="spinner"></span> 正在找回你的棋局…</div>
```

`props.sendMessage` 已改名为 `sendChat`，sandbox 的 `send()` 调用同步修改。

sandbox 也改用共用组件，去掉重复实现：

- 引入 `ChatComposer` 与 `PlayerAvatar`。
- 删除 `input`、`resizeInput`、`onEnter`，以及模板里的内联 `<form class="composer">`。
- 发送栏替换为：

```html
<p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
<ChatComposer
  v-model="draft" :disabled="expired || sending" :sending="sending"
  :placeholder="expired ? '房间已失效' : room?.status === 'waiting' ? '先留一句问候，等对方入座…' : '说点什么，边玩边聊…'"
  @send="send"
/>
```

- 对话列表的消息头像替换为：

```html
<PlayerAvatar :player="room?.players.find((player) => player.id === message.playerId)" :ai="message.playerId !== room?.selfPlayerId" small />
```

- 侧边栏的两个 `span.avatar` 替换为：

```html
<PlayerAvatar :player="room?.players.find((player) => player.id === room?.selfPlayerId)" :fallback-name="session.playerName" />
<PlayerAvatar :player="otherPlayer" ai />
```

- `send()` 成功后的 `nextTick`/滚动逻辑可以保留。

`statusText` 的标题改为：

```ts
const gameTitle = computed(() => isGomoku.value ? '五子棋' : '默契试验场');
```

模板中的固定标题、eyebrow 使用 `gameTitle`。

- [ ] **Step 7: 增加 CSS**

在 `web/style.css` 末尾追加（并移除/保留原 `.composer` 样式均可，`ChatComposer` 复用现有类名）：

```css
.player-avatar { width: 42px; height: 42px; border-radius: 14px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: #e3ebbc; color: #677743; }
.player-avatar.is-small { width: 30px; height: 30px; border-radius: 10px; }
.player-avatar img { width: 100%; height: 100%; object-fit: cover; }
.player-avatar.avatar-ai { background: #dfe9db; color: #6d875b; }
.avatar-letter { font-size: 17px; font-weight: 600; }
.player-avatar.is-small .avatar-letter { font-size: 12px; }

.gomoku-room { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 0 20px 12px; }
.gomoku-player { display: flex; align-items: start; gap: 10px; }
.gomoku-player-top { padding-top: 4px; }
.gomoku-player-bottom { align-items: center; }
.gomoku-player-copy { min-width: 0; flex: 1; }
.gomoku-player-name { display: flex; align-items: center; gap: 6px; }
.gomoku-player-name strong { font-size: 12px; font-weight: 600; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stone-tag { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.stone-tag-black { background: #3f4a38; }
.stone-tag-white { background: #fbfcf7; border: 1px solid #aab59b; }
.history-button { font-size: 10px; color: #859074; flex-shrink: 0; }
.chat-bubble { margin-top: 5px; background: #f0f3e9; color: #5e6c52; border-radius: 0 10px 10px 10px; padding: 7px 10px; font-size: 12px; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.chat-bubble-self { background: #e7efd8; border-radius: 10px 0 10px 10px; }
.chat-bubble-empty { color: #a7b197; background: transparent; padding-inline: 0; }

.gomoku-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; position: relative; }
.gomoku-status { display: inline-flex; align-items: center; gap: 6px; color: #8b977a; font-size: 10px; }
.gomoku-status i { width: 6px; height: 6px; border-radius: 50%; background: #b8c5a5; }
.gomoku-status.mine { color: #6f8457; }
.gomoku-status.mine i { background: #8da76a; }
.gomoku-board { position: relative; width: min(100%, 420px); aspect-ratio: 1; background: #f3efdf; border: 1px solid #d9d2bb; border-radius: 10px; box-shadow: 0 5px 0 #e4dfcd; }
.gomoku-grid { position: absolute; inset: 0; width: 100%; height: 100%; }
.gomoku-grid line { stroke: #b9c4a8; stroke-width: .035; }
.gomoku-grid .star { fill: #9fae89; }
.stone { stroke-width: .04; }
.stone-black { fill: #3f4a38; stroke: #2f3929; }
.stone-white { fill: #fbfcf7; stroke: #aab59b; }
.stone.winning { stroke: #c58a4a; stroke-width: .1; }
.last-move { fill: #c58a4a; }
.last-black { fill: #e7d7c0; }
.gomoku-hits { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(15, 1fr); grid-template-rows: repeat(15, 1fr); }
.gomoku-hit { border: 0; background: transparent; border-radius: 50%; padding: 0; cursor: pointer; touch-action: manipulation; }
.gomoku-hit:not(:disabled):active { background: #a5b68a40; }
.gomoku-result { position: absolute; inset: auto 0 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px; background: #fffefad9; backdrop-filter: blur(4px); }
.gomoku-result strong { font-size: 18px; letter-spacing: .5px; }
.rematch-count { font: 9px ui-monospace, monospace; margin-left: 5px; opacity: .7; }
.invite-inline { align-self: center; }
.gomoku-loading { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; color: #8b977a; font-size: 12px; }

.chat-history { max-height: 55vh; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 14px; }
.chat-history-empty { color: #9aa58a; font-size: 12px; text-align: center; padding: 28px 0; }
.history-message { display: flex; gap: 8px; align-items: start; }
.history-message.self { flex-direction: row-reverse; }
.history-body { max-width: 78%; }
.history-name { display: block; font-size: 9px; color: #a1ab93; margin-bottom: 4px; }
.history-message.self .history-name { text-align: right; }
.history-body p { background: #f0f3e9; color: #5e6c52; padding: 9px 12px; border-radius: 0 10px 10px 10px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.history-message.self .history-body p { background: #e7efd8; border-radius: 10px 0 10px 10px; }

@media (max-width: 700px) {
  .gomoku-room { padding: 0 14px calc(8px + env(safe-area-inset-bottom)); gap: 6px; }
  .gomoku-player-top { padding-top: 2px; }
  .gomoku-player .player-avatar { width: 34px; height: 34px; border-radius: 11px; }
  .gomoku-board { width: min(100%, 360px); }
  .gomoku-status { font-size: 9px; }
  .chat-bubble { font-size: 11px; padding: 6px 9px; }
  .gomoku-result strong { font-size: 16px; }
}
@media (max-height: 700px) {
  .gomoku-player .chat-bubble { display: none; }
}
```

- [ ] **Step 8: 跑类型检查和构建**

Run: `npm run typecheck`
Expected: pass。

Run: `npm run build`
Expected: pass。

- [ ] **Step 9: 浏览器检查 390×844**

启动 `npm run dev`，在 390×844 下创建五子棋房间，确认棋盘、上下玩家卡片、输入框均在视口内，无横向滚动；聊天发送后气泡出现；历史弹窗可打开。此时 Agent 尚未加入，棋盘应禁用。

---

### Task 8: 大厅五子棋卡片、头像输入与移动端收尾

**Files:**
- Modify: `web/components/LobbyPage.vue`
- Modify: `web/App.vue`
- Modify: `web/style.css`

**Interfaces:**
- Consumes: `GameInfo.actionSchema` 可空、`createRoom` 的 `avatarUrl`。
- Produces: 大厅两个游戏入口、创建弹窗头像输入、移动端布局收尾。

- [ ] **Step 1: 大厅卡片按游戏分支**

`LobbyPage.vue` 的卡片 art 改为：

```html
<div v-if="game.id === 'gomoku'" class="card-art gomoku-art" aria-hidden="true">
  <div class="mini-gomoku">
    <span v-for="index in 49" :key="index" class="mini-cell" :class="{ 'mini-stone': [9, 15, 17, 23, 25, 31, 33, 39].includes(index) }"></span>
  </div>
  <span class="art-coordinate">01 / GOMOKU</span><span class="art-corner">↗</span>
</div>
<div v-else class="card-art" aria-hidden="true">
  <!-- 保留现有 sandbox art -->
</div>
```

标题/描述/标签改为：

```html
<div class="card-title-row">
  <h3>{{ game.id === 'gomoku' ? '五子棋' : '默契试验场' }}</h3>
  <span class="badge">开放体验</span>
</div>
<p>{{ game.id === 'gomoku'
  ? '15×15 无禁手。创建者执黑先行，边下边聊，先连成五子者获胜。'
  : '先打个招呼，再找点默契。和你的 AI 在同一个房间里自由聊天。' }}</p>
<div class="game-tags">
  <span><AppIcon name="users" :size="15" /> {{ game.maxPlayers }} 位玩家</span>
  <span><AppIcon name="link" :size="15" /> MCP 接入</span>
  <span>{{ game.id === 'gomoku' ? '轮流落子' : '自由聊天' }}</span>
</div>
<div class="card-bottom">
  <span>{{ game.id === 'gomoku' ? '15×15 · 五子连珠' : '无固定回合 · 不计输赢' }}</span>
  <button class="button primary" @click="emit('create', game)">创建房间 <AppIcon name="arrow" :size="18" /></button>
</div>
```

- [ ] **Step 2: 创建弹窗增加头像链接**

`App.vue` 中已有 `const avatarUrl = ref('')`（Task 6 添加）。在昵称输入后增加：

```html
<label class="form-label" for="avatar-url">头像链接（可选）<span>{{ avatarUrl.length }} / 500</span></label>
<input
  id="avatar-url" v-model="avatarUrl" class="text-input" name="avatar-url"
  autocomplete="off" inputmode="url" placeholder="https://…"
  maxlength="500" :disabled="creating"
/>
<p class="field-hint">没有链接也可以，默认用名字首字。</p>
```

创建预览文案按游戏分支：

```html
<p>{{ selectedGame?.id === 'gomoku' ? '双人五子棋 · 15×15 · 可聊天' : '双人互动 · 自由聊天 · 不计输赢' }}</p>
```

`createRoom` 调用传入 `avatarUrl.value.trim()`。

- [ ] **Step 3: 增加大厅卡片样式**

```css
.card-art.gomoku-art { display: flex; align-items: center; justify-content: center; background: #eef2e4; }
.mini-gomoku { width: 152px; aspect-ratio: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(7, 1fr); background: #f3efdf; border: 1px solid #d9d2bb; border-radius: 8px; padding: 10px; gap: 0; box-shadow: 0 5px 0 #dfdbc9; }
.mini-cell { border-right: 1px solid #c6cfb6; border-bottom: 1px solid #c6cfb6; position: relative; }
.mini-cell:nth-child(7n) { border-right: 0; }
.mini-cell:nth-last-child(-n+7) { border-bottom: 0; }
.mini-stone::after { content: ''; position: absolute; inset: 18%; border-radius: 50%; background: #3f4a38; }
```

如果与现有 `.card-art` 的定位冲突，给 `.gomoku-art` 加 `position: relative` 并确保 `art-coordinate` 仍可见。

- [ ] **Step 4: 移动端收尾**

在 `@media (max-width: 700px)` 中补充：

```css
.gomoku-room { width: 100%; }
.gomoku-stage { width: 100%; }
.chat-history { max-height: 50vh; }
```

在 `@media (max-width: 370px)` 中补充：

```css
.gomoku-room { padding-inline: 10px; }
.gomoku-player-name strong { max-width: 96px; }
```

- [ ] **Step 5: 跑构建**

Run: `npm run typecheck && npm run build`
Expected: pass。

---

### Task 9: 完整验证

**Files:**
- 不新增生产文件；必要时临时脚本放 `/tmp`，不提交。

**Interfaces:**
- Consumes: 前 8 个任务的全部产出。

- [ ] **Step 1: 后端与前端自动化验证**

Run: `npm test`
Expected: 全部通过。

Run: `npm run typecheck`
Expected: pass。

Run: `npm run build`
Expected: pass，Vite 输出正常。

- [ ] **Step 2: 启动开发服务**

Run: `npm run dev`
Expected: 输出 `web: http://127.0.0.1:3001`、MCP URL 和本地 Bearer token。不要把 token 写进回复。

- [ ] **Step 3: 浏览器创建五子棋房间**

在 390×844 视口：

1. 打开 `http://127.0.0.1:3001`。
2. 大厅应同时看到五子棋和默契试验场，五子棋排在前面。
3. 创建五子棋房间，昵称填“人类”，头像链接留空。
4. 确认进入房间：上方空位显示“留给你的 AI”，中间棋盘，下方自己，底部输入框。
5. 等待状态下棋盘不可落子，聊天输入框可输入。

- [ ] **Step 4: MCP Agent 加入、聊天、下棋**

用临时脚本或 MCP 客户端执行：

1. `join_room`，roomId/inviteToken 来自邀请指令，playerName 为“阿蓝”。
2. `send_chat_message` 发送“我来了，边下边聊”。
3. 人类在浏览器回复一句，确认双端聊天同步，且聊天前后 `version` 不变。
4. Agent 作为白棋，按以下序列等回合落子：`(7,3)`、`(7,4)`、`(7,5)`、`(7,6)`、`(7,7)`。
5. 人类执黑，在 `(0,0)`、`(0,1)`、`(0,2)`、`(0,3)` 落子，故意让白棋连成五子。
6. 确认结束状态显示“你输了”，获胜连线高亮，棋盘不可再落子，聊天仍可发送。
7. 人类点“再来一局”，显示 `1 / 2`；Agent 调 `request_rematch` 后，棋盘清空，黑白互换，聊天记录保留。
8. 打开“对话记录”，确认消息完整、顺序正确。

- [ ] **Step 5: 默契试验场回归**

1. 回到大厅，创建默契试验场。
2. Agent 加入后，通过 `send_chat_message` 聊天；确认没有棋盘，聊天列表正常。
3. 确认 `submit_action` 对 sandbox 返回 `INVALID_ACTION`，不再有旧的消息动作。

- [ ] **Step 6: 错误与恢复回归**

1. 模拟离线，确认页面显示连接中断，恢复后自动同步。
2. 刷新页面，确认 session 恢复房间、聊天和棋盘。
3. 打开无效房间，确认“房间已失效”且输入框禁用。

- [ ] **Step 7: 响应式回归**

在 390×844、320×568、1440×1000 检查：

- 无横向滚动。
- 棋盘、气泡、输入框不重叠。
- 控制台无 error/warning。
- 320×568 下棋盘仍可点击落子。

---

## Self-Review

- **Spec coverage:** 聊天模型/版本、五子棋规则、重开、sandbox 纯聊天、MCP/REST、头像、移动端布局、测试与验收均有对应任务。
- **类型一致性:** `sendChat`、`requestRematch`、`place`、`revision`、`avatarUrl`、`ChatMessage`、`GomokuView` 在前后端任务中使用同一命名。
- **风险:** Task 2 的 chat-only 测试依赖 Task 5；若要求每步全绿，把该测试移到 Task 5。Task 5 会集中修改旧 sandbox 动作测试，是预期内的一次较大测试迁移。
