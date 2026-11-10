import { randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import { RoomError } from './errors.ts';
import type { GameDefinition, JsonObject, Player } from './game.ts';

export const CHAT_LIMIT = 200;
export const CHAT_TEXT_LIMIT = 500;

export type ChatMessage = {
  id: string;
  playerId: string;
  text: string;
  at: string;
};

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

type Room = {
  id: string;
  game: GameDefinition;
  status: RoomView['status'];
  version: number;
  revision: number;
  players: Player[];
  credentials: Map<string, string>;
  inviteToken: string;
  state: JsonObject;
  chat: ChatMessage[];
  rematchVotes: Set<string>;
};

type PlayerAccess = { roomId: string; playerToken: string };

function normalizeAvatar(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class RoomStore {
  private readonly games: Map<string, GameDefinition>;
  private readonly rooms = new Map<string, Room>();

  constructor(games: GameDefinition[]) {
    this.games = new Map(games.map((game) => [game.id, game]));
  }

  listGames() {
    return [...this.games.values()].map((game) => ({
      id: game.id,
      title: game.title,
      description: game.description,
      minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers,
      actionSchema: game.actionSchema ? z.toJSONSchema(game.actionSchema) : null,
    }));
  }

  createRoom(input: { gameId: string; playerName: string; avatarUrl?: string }) {
    const game = this.games.get(input.gameId);
    if (!game) throw new RoomError('GAME_NOT_FOUND', 'Choose a game returned by list_games.');
    const avatarUrl = normalizeAvatar(input.avatarUrl);
    const player: Player = {
      id: randomUUID(),
      name: input.playerName,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
    const playerToken = randomBytes(32).toString('base64url');
    const room: Room = {
      id: randomUUID(),
      game,
      status: game.minPlayers <= 1 ? 'active' : 'waiting',
      version: 1,
      revision: 1,
      players: [player],
      credentials: new Map([[playerToken, player.id]]),
      inviteToken: randomBytes(32).toString('base64url'),
      state: game.initialState([player]),
      chat: [],
      rematchVotes: new Set(),
    };
    const view = this.view(room, player.id);
    this.rooms.set(room.id, room);
    return { room: view, playerToken, inviteToken: room.inviteToken };
  }

  joinRoom(input: { roomId: string; inviteToken: string; playerName: string; avatarUrl?: string }) {
    const room = this.findRoom(input.roomId);
    if (input.inviteToken !== room.inviteToken) {
      throw new RoomError('INVALID_INVITE', 'A valid room invitation is required.');
    }
    if (room.status === 'finished') throw new RoomError('ROOM_FINISHED', 'This game has ended.');
    if (room.players.length >= room.game.maxPlayers) throw new RoomError('ROOM_FULL', 'This room is full.');
    const avatarUrl = normalizeAvatar(input.avatarUrl);
    const player: Player = {
      id: randomUUID(),
      name: input.playerName,
      ...(avatarUrl ? { avatarUrl } : {}),
    };
    const playerToken = randomBytes(32).toString('base64url');
    const players = [...room.players, player];
    const state = room.status === 'waiting' && players.length >= room.game.minPlayers
      ? room.game.initialState(players)
      : room.state;
    const nextRoom: Room = {
      ...room,
      players,
      credentials: new Map([...room.credentials, [playerToken, player.id]]),
      status: players.length >= room.game.minPlayers ? 'active' : 'waiting',
      version: room.version + 1,
      revision: room.revision + 1,
      state,
    };
    const view = this.view(nextRoom, player.id);
    this.rooms.set(room.id, nextRoom);
    return { room: view, playerToken };
  }

  getRoom(input: PlayerAccess): RoomView {
    const { room, playerId } = this.authenticate(input);
    return this.view(room, playerId);
  }

  submitAction(input: PlayerAccess & { expectedVersion: number; action: JsonObject }): RoomView {
    const { room, playerId } = this.authenticate(input);
    if (room.status === 'waiting') throw new RoomError('ROOM_NOT_READY', 'Wait for the other players to join.');
    if (room.status === 'finished') throw new RoomError('ROOM_FINISHED', 'This game has ended.');
    if (input.expectedVersion !== room.version) {
      throw new RoomError('VERSION_CONFLICT', 'The room changed. Call get_room and reconsider your action before resubmitting.');
    }
    if (!room.game.actionSchema || !room.game.applyAction) {
      throw new RoomError('INVALID_ACTION', 'This room is chat-only. Use send_chat_message instead.');
    }
    const action = room.game.actionSchema.safeParse(input.action);
    if (!action.success) throw new RoomError('INVALID_ACTION', 'The action does not match this game’s actionSchema.');
    const transition = room.game.applyAction(
      structuredClone(room.state),
      { playerId, players: structuredClone(room.players) },
      action.data,
    );
    const nextRoom: Room = {
      ...room,
      state: transition.state,
      status: transition.finished ? 'finished' : 'active',
      version: room.version + 1,
      revision: room.revision + 1,
    };
    const view = this.view(nextRoom, playerId);
    this.rooms.set(room.id, nextRoom);
    return view;
  }

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

  private findRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Rooms are lost when the service restarts.');
    return room;
  }

  private authenticate(input: PlayerAccess) {
    const room = this.findRoom(input.roomId);
    const playerId = room.credentials.get(input.playerToken);
    if (!playerId) throw new RoomError('UNAUTHORIZED', 'Use the private playerToken returned when you created or joined this room.');
    return { room, playerId };
  }

  private view(room: Room, playerId: string): RoomView {
    return {
      id: room.id,
      gameId: room.game.id,
      status: room.status,
      version: room.version,
      revision: room.revision,
      players: structuredClone(room.players),
      selfPlayerId: playerId,
      chat: structuredClone(room.chat),
      rematchVotes: [...room.rematchVotes],
      state: structuredClone(room.game.getPlayerView(structuredClone(room.state), {
        playerId,
        players: structuredClone(room.players),
      })),
    };
  }
}
