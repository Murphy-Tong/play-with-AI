import type { RoomSession } from './types.ts';

export const sessionKey = 'play-with-ai.room';
export const AGENT_CLIENT_ID = 'lingjun';

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
    `1. 先确定你的固定身份 clientId：${AGENT_CLIENT_ID}。把它写进你本地的文件（例如 ~/.play-with-ai-client），以后每次重连都读同一个值，不要临时更换。`,
    `2. 调用 join_room，roomId 为 ${session.roomId}，inviteToken 为 ${session.inviteToken ?? ''}，clientId 为 ${AGENT_CLIENT_ID}，playerName 请使用你的名字。`,
    '3. 保存返回的私有 playerToken，不要分享；用 get_room 查看 gameId、局面和聊天。token 失效时不要换身份，用同一个 clientId 再调一次 join_room，会取回原来的座位并换发新 token。',
    '4. 调用 list_games，按 gameId 找到当前游戏和 actionSchema。',
    '5. 聊天用 send_chat_message；五子棋落子用 submit_action，以最新 version 作为 expectedVersion。',
    '6. 每次行动后，用最新 revision 调用 wait_for_room_update 等我：它会在我落子或说话时立刻返回，超时（默认 25 秒）就再调用一次，不要高速轮询。',
    '7. 我让你发图片时，用 drop_image 传一个公开的 http(s) 图片链接，它会像炸弹一样落到屏幕上。',
    '8. 说完再见或对局结束时，用 leave_room 让出座位。',
  ].join('\n');
}

export function shouldAcceptRoom(
  sessionRoomId: string,
  current: { id: string; revision: number } | null,
  next: { id: string; revision: number },
): boolean {
  return next.id === sessionRoomId &&
    (!current || current.id !== next.id || next.revision >= current.revision);
}

export function roomErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    ROOM_NOT_FOUND: '房间已失效，服务重启会清空房间。回到大厅重新创建吧。',
    GAME_NOT_FOUND: '这个体验暂时不可用，请刷新大厅。',
    UNAUTHORIZED: '房间凭证已失效，请回到大厅重新创建。',
    INVALID_INVITE: '邀请信息不正确，请向房主确认。',
    ROOM_FULL: '房间已经坐满。如果之前坐在这里，用同一个 clientId 重新 join 取回座位；否则请在房间里请离一个空闲座位。',
    FORBIDDEN: '只有房主可以请离其他座位。',
    PLAYER_NOT_FOUND: '这个座位已经空了。',
    INVALID_TARGET: '房主不能请离自己。',
    ROOM_NOT_READY: '还在等另一位玩家。可以先聊聊，加入后再开始对局。',
    ROOM_FINISHED: '本场互动已经结束。',
    INVALID_MESSAGE: '消息需要 1–500 个字符，请检查后再发送。',
    INVALID_IMAGE: '图片需要是公开的 http(s) 链接，请检查后再发。',
    ROOM_NOT_FINISHED: '当前对局还没有结束，结束后才能再来一局。',
    VERSION_CONFLICT: '对方刚刚更新了房间。已刷新局面，请确认后再发送。',
    INVALID_ACTION: '这条行动不符合游戏规则，请检查后重试。',
    INVALID_INPUT: '请检查输入内容后重试。',
    NETWORK_ERROR: '暂时连接不上服务，请检查网络或稍后重试。',
    FORBIDDEN_ORIGIN: '请从服务提供的页面地址打开。',
  };
  return messages[code] ?? '操作没有完成，请稍后再试。';
}
