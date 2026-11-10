export type RoomErrorCode =
  | 'GAME_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_INVITE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_READY'
  | 'ROOM_FINISHED'
  | 'VERSION_CONFLICT'
  | 'INVALID_ACTION'
  | 'INVALID_MESSAGE'
  | 'INVALID_IMAGE'
  | 'INVALID_INPUT'
  | 'INVALID_TARGET'
  | 'FORBIDDEN'
  | 'PLAYER_NOT_FOUND'
  | 'ROOM_NOT_FINISHED';

export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}
