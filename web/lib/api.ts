import { roomErrorMessage } from './session.ts';
import type { GameInfo, RoomCreated, RoomSession, RoomView } from './types.ts';

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(roomErrorMessage(code));
    this.code = code;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; playerToken?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.playerToken ? { Authorization: `Bearer ${options.playerToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.error?.code ?? 'INTERNAL_ERROR');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  games: () => request<{ games: GameInfo[] }>('/games'),
  createRoom: (gameId: string, playerName: string) => request<RoomCreated>('/rooms', {
    method: 'POST', body: { gameId, playerName },
  }),
  room: (session: RoomSession) => request<RoomView>(`/rooms/${encodeURIComponent(session.roomId)}`, {
    playerToken: session.playerToken,
  }),
  send: (session: RoomSession, expectedVersion: number, text: string) => request<RoomView>(`/rooms/${encodeURIComponent(session.roomId)}/actions`, {
    method: 'POST', playerToken: session.playerToken,
    body: { expectedVersion, action: { type: 'message', text } },
  }),
};
