import type { RoomStore, RoomView } from '../../src/rooms.ts';

export type { RoomView };
export type GameInfo = ReturnType<RoomStore['listGames']>[number];
export type RoomCreated = ReturnType<RoomStore['createRoom']>;
export type RoomSession = {
  roomId: string;
  playerToken: string;
  inviteToken?: string;
  playerName: string;
};
