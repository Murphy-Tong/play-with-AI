import { randomBytes, randomUUID } from 'node:crypto';
import * as z from 'zod';
import { RoomError } from './errors.ts';
import type { GameDefinition, JsonObject, Player } from './game.ts';

export const CHAT_LIMIT = 200;
export const CHAT_TEXT_LIMIT = 500;
export const IMAGE_DROP_LIMIT = 20;
export const IMAGE_URL_LIMIT = 2048;
export const IMAGE_CAPTION_LIMIT = 80;
export const CLIENT_ID_LIMIT = 80;
export const IDLE_SEAT_MS = 10 * 60 * 1000;

export type ChatMessage = {
  id: string;
  playerId: string;
  text: string;
  at: string;
};

export type ImageDrop = {
  id: string;
  playerId: string;
  url: string;
  caption?: string;
  at: string;
};

export type RoomView = {
  id: string;
  gameId: string;
  status: 'waiting' | 'active' | 'finished';
  version: number;
  revision: number;
  players: Player[];
  hostId: string;
  selfPlayerId: string;
  state: JsonObject;
  chat: ChatMessage[];
  imageDrops: ImageDrop[];
  rematchVotes: string[];
};

type Room = {
  id: string;
  game: GameDefinition;
  status: RoomView['status'];
  version: number;
  revision: number;
  players: Player[];
  hostId: string;
  credentials: Map<string, string>;
  seatClientIds: Map<string, string>;
  lastSeen: Map<string, number>;
  inviteToken: string;
  state: JsonObject;
  chat: ChatMessage[];
  imageDrops: ImageDrop[];
  rematchVotes: Set<string>;
};

type PlayerAccess = { roomId: string; playerToken: string };

function normalizeAvatar(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeClientId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > CLIENT_ID_LIMIT) {
    throw new RoomError('INVALID_INPUT', `clientId is limited to ${CLIENT_ID_LIMIT} characters.`);
  }
  return trimmed;
}

function normalizeImageUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RoomError('INVALID_IMAGE', 'Image drops need a public http(s) image URL.');
  }
  if (!trimmed || trimmed.length > IMAGE_URL_LIMIT || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new RoomError('INVALID_IMAGE', 'Image drops need a public http(s) image URL.');
  }
  return trimmed;
}

export class RoomStore {
  private readonly games: Map<string, GameDefinition>;
  private readonly rooms = new Map<string, Room>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly idleSeatMs: number;

  constructor(games: GameDefinition[], options: { idleSeatMs?: number } = {}) {
    this.games = new Map(games.map((game) => [game.id, game]));
    this.idleSeatMs = options.idleSeatMs ?? IDLE_SEAT_MS;
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

  createRoom(input: { gameId: string; playerName: string; avatarUrl?: string; clientId?: string }) {
    const game = this.games.get(input.gameId);
    if (!game) throw new RoomError('GAME_NOT_FOUND', 'Choose a game returned by list_games.');
    const avatarUrl = normalizeAvatar(input.avatarUrl);
    const clientId = normalizeClientId(input.clientId);
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
      hostId: player.id,
      credentials: new Map([[playerToken, player.id]]),
      seatClientIds: clientId ? new Map([[player.id, clientId]]) : new Map(),
      lastSeen: new Map([[player.id, Date.now()]]),
      inviteToken: randomBytes(32).toString('base64url'),
      state: game.initialState([player]),
      chat: [],
      imageDrops: [],
      rematchVotes: new Set(),
    };
    const view = this.view(room, player.id);
    this.save(room);
    return { room: view, playerToken, inviteToken: room.inviteToken };
  }

  joinRoom(input: {
    roomId: string;
    inviteToken: string;
    playerName: string;
    avatarUrl?: string;
    clientId?: string;
  }) {
    let room = this.findRoom(input.roomId);
    if (input.inviteToken !== room.inviteToken) {
      throw new RoomError('INVALID_INVITE', 'A valid room invitation is required.');
    }
    const clientId = normalizeClientId(input.clientId);
    const swept = this.sweepIdleSeats(room);
    if (!swept) throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Rooms are lost when the service restarts.');
    room = swept;

    if (clientId) {
      const recovering = room.players.find((player) => room.seatClientIds.get(player.id) === clientId);
      if (recovering) {
        const playerToken = randomBytes(32).toString('base64url');
        const credentials = new Map([...room.credentials].filter(([, playerId]) => playerId !== recovering.id));
        credentials.set(playerToken, recovering.id);
        const nextRoom: Room = {
          ...room,
          credentials,
          lastSeen: new Map(room.lastSeen).set(recovering.id, Date.now()),
          revision: room.revision + 1,
        };
        const view = this.view(nextRoom, recovering.id);
        this.save(nextRoom);
        return { room: view, playerToken, recovered: true };
      }
    }

    if (room.status === 'finished') throw new RoomError('ROOM_FINISHED', 'This game has ended.');
    if (room.players.length >= room.game.maxPlayers) {
      throw new RoomError(
        'ROOM_FULL',
        'This room has no empty seat. If you already held a seat here, call join_room again with the same clientId you joined with the first time to take it back; otherwise ask the host to release an idle seat.',
      );
    }
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
      seatClientIds: clientId ? new Map([...room.seatClientIds, [player.id, clientId]]) : room.seatClientIds,
      lastSeen: new Map([...room.lastSeen, [player.id, Date.now()]]),
      status: players.length >= room.game.minPlayers ? 'active' : 'waiting',
      version: room.version + 1,
      revision: room.revision + 1,
      state,
    };
    const view = this.view(nextRoom, player.id);
    this.save(nextRoom);
    return { room: view, playerToken, recovered: false };
  }

  getRoom(input: PlayerAccess): RoomView {
    const { room, playerId } = this.authenticate(input);
    return this.view(room, playerId);
  }

  async waitForChange(input: PlayerAccess & { afterRevision: number; timeoutMs: number }): Promise<RoomView> {
    const { room, playerId } = this.authenticate(input);
    if (room.revision !== input.afterRevision) return this.view(room, playerId);
    await new Promise<void>((resolve) => {
      const listeners = this.waiters.get(room.id) ?? new Set<() => void>();
      this.waiters.set(room.id, listeners);
      const done = () => {
        clearTimeout(timer);
        listeners.delete(done);
        if (!listeners.size) this.waiters.delete(room.id);
        resolve();
      };
      const timer = setTimeout(done, input.timeoutMs);
      listeners.add(done);
      if (this.rooms.get(room.id)?.revision !== input.afterRevision) done();
    });
    return this.getRoom(input);
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
    this.save(nextRoom);
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
    this.save(nextRoom);
    return view;
  }

  sendImage(input: PlayerAccess & { imageUrl: string; caption?: string }): RoomView {
    const { room, playerId } = this.authenticate(input);
    const url = normalizeImageUrl(input.imageUrl);
    const caption = input.caption?.trim();
    if (caption && caption.length > IMAGE_CAPTION_LIMIT) {
      throw new RoomError('INVALID_IMAGE', `Image captions are limited to ${IMAGE_CAPTION_LIMIT} characters.`);
    }
    const imageDrops = [
      ...room.imageDrops,
      { id: randomUUID(), playerId, url, ...(caption ? { caption } : {}), at: new Date().toISOString() },
    ].slice(-IMAGE_DROP_LIMIT);
    const nextRoom: Room = { ...room, imageDrops, revision: room.revision + 1 };
    const view = this.view(nextRoom, playerId);
    this.save(nextRoom);
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
    this.save(nextRoom);
    return view;
  }

  leaveRoom(input: PlayerAccess): { roomId: string; left: true } {
    const { room, playerId } = this.authenticate(input);
    this.releaseSeat(room, playerId);
    return { roomId: room.id, left: true };
  }

  kickPlayer(input: PlayerAccess & { targetPlayerId: string }): RoomView {
    const { room, playerId } = this.authenticate(input);
    if (playerId !== room.hostId) {
      throw new RoomError('FORBIDDEN', 'Only the host can release another player’s seat.');
    }
    if (input.targetPlayerId === playerId) {
      throw new RoomError('INVALID_TARGET', 'The host cannot remove their own seat; use leave_room instead.');
    }
    if (!room.players.some((player) => player.id === input.targetPlayerId)) {
      throw new RoomError('PLAYER_NOT_FOUND', 'That seat is already empty.');
    }
    const nextRoom = this.withoutSeat(room, input.targetPlayerId);
    const view = this.view(nextRoom, playerId);
    this.save(nextRoom);
    return view;
  }

  subscribe(input: PlayerAccess, listener: () => void): () => void {
    const { room } = this.authenticate(input);
    const listeners = this.waiters.get(room.id) ?? new Set<() => void>();
    this.waiters.set(room.id, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.waiters.delete(room.id);
    };
  }

  private releaseSeat(room: Room, playerId: string) {
    const nextRoom = this.withoutSeat(room, playerId);
    if (!nextRoom.players.length) this.removeRoom(room.id);
    else this.save(nextRoom);
  }

  private withoutSeat(room: Room, playerId: string): Room {
    const players = room.players.filter((player) => player.id !== playerId);
    const belowMinimum = players.length < room.game.minPlayers;
    return {
      ...room,
      players,
      hostId: room.hostId === playerId ? (players[0]?.id ?? '') : room.hostId,
      credentials: new Map([...room.credentials].filter(([, id]) => id !== playerId)),
      seatClientIds: new Map([...room.seatClientIds].filter(([id]) => id !== playerId)),
      lastSeen: new Map([...room.lastSeen].filter(([id]) => id !== playerId)),
      rematchVotes: new Set([...room.rematchVotes].filter((id) => id !== playerId)),
      status: belowMinimum ? 'waiting' : room.status,
      state: belowMinimum && players.length ? room.game.initialState(structuredClone(players)) : room.state,
      version: room.version + 1,
      revision: room.revision + 1,
    };
  }

  private sweepIdleSeats(room: Room): Room | null {
    const cutoff = Date.now() - this.idleSeatMs;
    const idleIds = room.players
      .filter((player) => (room.lastSeen.get(player.id) ?? 0) < cutoff)
      .map((player) => player.id);
    if (!idleIds.length) return room;
    let nextRoom = room;
    for (const playerId of idleIds) nextRoom = this.withoutSeat(nextRoom, playerId);
    if (!nextRoom.players.length) {
      this.removeRoom(room.id);
      return null;
    }
    this.save(nextRoom);
    return nextRoom;
  }

  private removeRoom(roomId: string) {
    this.rooms.delete(roomId);
    const listeners = this.waiters.get(roomId);
    this.waiters.delete(roomId);
    for (const wake of [...(listeners ?? [])]) wake();
  }

  private save(room: Room) {
    const changed = this.rooms.get(room.id)?.revision !== room.revision;
    this.rooms.set(room.id, room);
    if (!changed) return;
    for (const wake of [...(this.waiters.get(room.id) ?? [])]) wake();
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
    room.lastSeen.set(playerId, Date.now());
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
      hostId: room.hostId,
      selfPlayerId: playerId,
      chat: structuredClone(room.chat),
      imageDrops: structuredClone(room.imageDrops),
      rematchVotes: [...room.rematchVotes],
      state: structuredClone(room.game.getPlayerView(structuredClone(room.state), {
        playerId,
        players: structuredClone(room.players),
      })),
    };
  }
}
