import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { api, ApiError } from './api.ts';
import { parseSession, sessionKey, shouldAcceptRoom } from './session.ts';
import type { GameInfo, RoomSession, RoomView } from './types.ts';

export function usePlayground() {
  const games = shallowRef<GameInfo[]>([]);
  const gamesLoading = ref(true);
  const gamesError = ref('');
  const session = shallowRef<RoomSession | null>(null);
  const room = shallowRef<RoomView | null>(null);
  const page = ref<'lobby' | 'room'>('lobby');
  const roomLoading = ref(false);
  const roomError = ref('');
  const sendError = ref('');
  const storageNotice = ref('');
  const expired = ref(false);
  const sending = ref(false);
  const creating = ref(false);
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let polling = false;

  try {
    session.value = parseSession(sessionStorage.getItem(sessionKey));
    if (session.value) page.value = 'room';
  } catch {
    storageNotice.value = '浏览器禁用了本地保存，关闭或刷新页面后将无法恢复房间。';
  }

  const canPoll = computed(() => page.value === 'room' && !!session.value && !expired.value);

  async function loadGames() {
    gamesLoading.value = true;
    gamesError.value = '';
    try { games.value = (await api.games()).games; }
    catch (error) { gamesError.value = (error as Error).message; }
    finally { gamesLoading.value = false; }
  }

  function acceptRoom(snapshot: RoomView) {
    if (session.value && shouldAcceptRoom(session.value.roomId, room.value, snapshot)) room.value = snapshot;
  }

  async function refreshRoom() {
    const current = session.value;
    if (!current || expired.value) return;
    roomLoading.value = true;
    try {
      const snapshot = await api.room(current);
      if (session.value !== current) return;
      acceptRoom(snapshot);
      roomError.value = '';
    } catch (error) {
      if (session.value !== current) return;
      roomError.value = (error as Error).message;
      if (error instanceof ApiError && ['ROOM_NOT_FOUND', 'UNAUTHORIZED'].includes(error.code)) expired.value = true;
    } finally {
      if (session.value === current) roomLoading.value = false;
    }
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (disposed || !canPoll.value || document.hidden || polling) return;
    polling = true;
    await refreshRoom();
    polling = false;
    if (!disposed && canPoll.value && !document.hidden) pollTimer = setTimeout(() => { void poll(); }, 2500);
  }

  async function createRoom(gameId: string, playerName: string, avatarUrl?: string) {
    creating.value = true;
    try {
      const created = await api.createRoom(gameId, playerName.trim(), avatarUrl?.trim() || undefined);
      session.value = {
        roomId: created.room.id,
        playerToken: created.playerToken,
        inviteToken: created.inviteToken,
        playerName: playerName.trim(),
      };
      try { sessionStorage.setItem(sessionKey, JSON.stringify(session.value)); }
      catch { storageNotice.value = '房间已创建，但浏览器不允许保存凭证。请不要刷新或关闭当前页面。'; }
      room.value = created.room;
      expired.value = false;
      roomError.value = '';
      sendError.value = '';
      page.value = 'room';
    } finally {
      creating.value = false;
    }
  }

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

  function visibilityChanged() {
    clearTimeout(pollTimer);
    if (!document.hidden) void poll();
  }
  watch([page, session, expired], () => { void poll(); });
  onMounted(() => {
    void loadGames();
    void poll();
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('online', visibilityChanged);
  });
  onUnmounted(() => {
    disposed = true;
    clearTimeout(pollTimer);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('online', visibilityChanged);
  });

  return { games, gamesLoading, gamesError, session, room, page, roomLoading, roomError, sendError, storageNotice, expired, sending, creating, loadGames, refreshRoom, createRoom, sendChat, place, requestRematch };
}
