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
