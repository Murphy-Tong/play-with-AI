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

test('gomoku restart keeps the colors when no stone was placed yet', () => {
  const restarted = gomokuGame.restart!(players, gomokuGame.initialState(players)) as JsonObject & {
    blackPlayerId: string; whitePlayerId: string;
  };
  assert.equal(restarted.blackPlayerId, 'black-player');
  assert.equal(restarted.whitePlayerId, 'white-player');
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
