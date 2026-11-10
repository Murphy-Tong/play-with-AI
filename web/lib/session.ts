import type { RoomSession } from './types.ts';

export const sessionKey = 'play-with-ai.room';

export function parseSession(value: string | null): RoomSession | null {
  try {
    const data: unknown = JSON.parse(value ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const session = data as Record<string, unknown>;
    if (typeof session.roomId !== 'string' || !session.roomId ||
        typeof session.playerToken !== 'string' || !session.playerToken ||
        typeof session.playerName !== 'string' || !session.playerName ||
        (session.inviteToken !== undefined && typeof session.inviteToken !== 'string')) return null;
    return {
      roomId: session.roomId,
      playerToken: session.playerToken,
      playerName: session.playerName,
      ...(typeof session.inviteToken === 'string' ? { inviteToken: session.inviteToken } : {}),
    };
  } catch {
    return null;
  }
}

export function buildInvitation(session: RoomSession): string {
  return [
    '来「同游」和我一起玩。请使用已配置的 play-with-ai MCP：',
    '1. 调用 list_games，了解 sandbox 的行动格式。',
    `2. 调用 join_room，roomId 为 ${session.roomId}，inviteToken 为 ${session.inviteToken ?? ''}，playerName 请使用你的名字。`,
    '3. 保存返回的私有 playerToken，不要分享；随后使用 get_room 查看局面。',
    '4. 用最新 version 作为 expectedVersion，调用 submit_action 发送 {"type":"message","text":"你好，我来啦！"}。',
    '这是双人消息沙盒，没有固定回合。不要重复加入，也不要持续高速轮询；等待我的指示再继续。',
  ].join('\n');
}

export function shouldAcceptRoom(sessionRoomId: string, current: { id: string; version: number } | null, next: { id: string; version: number }): boolean {
  return next.id === sessionRoomId && (!current || current.id !== next.id || next.version >= current.version);
}

export function roomErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    ROOM_NOT_FOUND: '房间已失效，服务重启会清空房间。回到大厅重新创建吧。',
    GAME_NOT_FOUND: '这个体验暂时不可用，请刷新大厅。',
    UNAUTHORIZED: '房间凭证已失效，请回到大厅重新创建。',
    INVALID_INVITE: '邀请信息不正确，请向房主确认。',
    ROOM_FULL: '这个房间已经坐满了。',
    ROOM_NOT_READY: '还在等另一位玩家，加入后就能发送消息。',
    ROOM_FINISHED: '本场互动已经结束。',
    VERSION_CONFLICT: '对方刚刚更新了房间。已刷新局面，请确认后再发送。',
    INVALID_ACTION: '这条行动不符合游戏规则，请检查后重试。',
    INVALID_INPUT: '请检查输入内容后重试。',
    NETWORK_ERROR: '暂时连接不上服务，请检查网络或稍后重试。',
    FORBIDDEN_ORIGIN: '请从服务提供的页面地址打开。',
  };
  return messages[code] ?? '操作没有完成，请稍后再试。';
}
