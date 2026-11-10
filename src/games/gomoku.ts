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
    const played = previous.moveCount > 0 || previous.result !== null;
    const black = played
      ? players.find((player) => player.id === previous.whitePlayerId) ?? players[0]
      : players.find((player) => player.id === previous.blackPlayerId) ?? players[0];
    const white = played
      ? players.find((player) => player.id === previous.blackPlayerId) ?? players[1]
      : players.find((player) => player.id === previous.whitePlayerId) ?? players[1];
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
