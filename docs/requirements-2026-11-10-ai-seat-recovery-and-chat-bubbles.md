# 需求：AI 座位可恢复 + 聊天气泡化（2026-11-10，由灵均以 AI 玩家身份实测提出）

实测环境：本机 `node src/index.ts --dev --lan`，端口 3001，五子棋（maxPlayers=2）。
触发场景：房主建好房、把邀请文本发给 AI；AI 用 MCP `join_room` 入座；随后 AI 侧会话重启（MCP 客户端重连 / 上下文压缩），本地没留下 `playerToken`。

## P0-1 座位一旦断线就永久锁死，且没有任何恢复入口

证据：
- `src/rooms.ts:132` — `if (room.players.length >= room.game.maxPlayers) throw new RoomError('ROOM_FULL', ...)`
- `src/rooms.ts:283-288` — `authenticate()` 只认 `credentials` 里那张 join 时发的随机 token
- `src/mcp.ts:49` / `join_room` description — 明确要求「Never join repeatedly to recover a seat」

实测请求（带正确的 inviteToken，playerName 相同）：

```
POST /api/rooms/45c7a598-.../join
{"inviteToken":"aR0VTPS3...","playerName":"灵均"}
→ 400 {"error":{"code":"ROOM_FULL","message":"This room is full."}}
```

后果：AI 侧只要丢了那一串 base64url，就再也进不去；房主除了毁房重建没有别的路（房间全在内存，重启即空）。而邀请文本第 2 条又要求 AI「保存 playerToken」——MCP 客户端不保证能把它持久化成文件，这本身就是不可靠假设。

需求：

1. `join_room` 增加可选参数 `clientId`（客户端自己持久化的稳定标识，如 `lingjun`），`create_room` / `join_room` 都接受。
   - 同一 `clientId` 在**同一房间**再次 join：恢复原 `playerId` 与座位，**换发新 token**，不动 `version` / `state` / 棋盘，`revision + 1` 让对面知道有人回来了。
   - 不同 `clientId` 且房间已满：才返回 `ROOM_FULL`。
2. 或者（更小改动）`join_room` 返回一个长期有效的 `resumeToken`，`get_room` / `wait_for_room_update` / `submit_action` 同时接受 `playerToken` 或 `resumeToken`。
3. `ROOM_FULL` 的错误信息要可操作，例如：「房间已满。若你是先前断线的玩家，请在 invitation 里向房主索取 `clientId` 重连，或请房主重建房间。」
4. 邀请文本（`web/lib/session.ts: buildInvitation`）把 `clientId` 一起写进去，并要求 AI 先写入本地文件再 join，而不是只在上下文里记 `playerToken`。

## P0-2 断线座位不回收

证据：`src/` 里没有任何 `lastSeen` / heartbeat / 超时踢人逻辑（`grep -rn "stale|heartbeat|leave|kick"` 在 `src/` 无命中）。

需求：
1. 每个玩家记录 `lastSeenAt`，任何带凭证的调用都刷新它。
2. 座位超过 N 分钟（建议 10）无调用 → 视为离开，释放座位（对局中则把房间标记 `paused` 或直接判负，由 game adapter 决定）。
3. 附带 `leave_room` 工具 / `DELETE /rooms/:id/players/me`，让客户端主动还座。

## P0-3 房主在 UI 上无法清理座位

需求：房间页玩家列表里给房主一个「请离席」按钮，走同一个释放座位接口。

## P1-1 五子棋局面里聊天气泡被 CSS 整个藏掉了 —— 用户只能去「对话记录」列表看

证据：
- `web/style.css:206-208`
  ```css
  @media (max-height: 700px) {
    .gomoku-player .chat-bubble { display: none; }
  }
  ```
  矮屏（笔记本浏览器、手机横屏、以及房主缩小窗口）下气泡直接 `display:none`，消息只出现在侧栏 `ChatHistory.vue` 的列表里。实测用户反馈：「我只能在消息列表里面看」。
- 即便不隐藏，`web/style.css:146` 的 `.chat-bubble` 是 `-webkit-line-clamp: 2` 静态文本，挂在玩家卡片下面 —— 新消息不会「冒出来」，没有时间轴、没有出现动画。

需求：

1. 房间主屏（`.gomoku-stage` 上层）加一个**新消息气泡浮层**：对方的消息到达后，在棋盘上方/侧上方弹出气泡，2–4 秒后淡出，连续多条向上堆叠（最多 3 条）。不受 `max-height` 媒体查询影响。
2. 消息进房间要有出现动画（fade+rise），自己做消息可以弱化或只在自己头像侧显示。
3. `ChatHistory.vue` 保留为历史面板，但不要是唯一入口。
4. 若尺寸实在不够，宁可把棋盘缩一点，也不要隐藏聊天。

## P1-2 轮询延迟让「立刻看到」不成立

证据：`web/lib/usePlayground.ts:69` — 固定 `setTimeout(poll, 2500)`；`document.hidden` 时不轮询。

需求：支持 SSE 或 WebSocket 推送（`wait_for_room_update` 服务端已有 waiter 机制，`src/rooms.ts:163` 的 `waiters` 可以直接复用给浏览器的 `GET /rooms/:id/events`），浏览器端订阅 `revision` 变化。轮询保留作兜底。

## P2 文档/提示词自相矛盾

`src/mcp.ts:49` 要求 AI「Never join repeatedly to recover a seat」，但当前实现下重复 join 是唯一（且必然失败）的恢复尝试。上线 P0-1 后同步改这段 instructions 和 `join_room` 的 description，写清恢复流程。
