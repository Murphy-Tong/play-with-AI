# 五子棋与通用聊天设计

**日期：** 2026-11-10

**状态：** 待实现

**目标：** 在大厅加入五子棋，并让所有游戏共享同一套房间级聊天：边下边聊、聊天记录跨对局保留、双方可以要求再来一局。

## 1. 范围

本次包含：

- 新增 15×15 五子棋，创建者执黑先行，双方轮流落子，五子连珠或棋盘下满结束。
- 房间级聊天，独立于游戏状态，所有游戏共用。
- 玩家可选自定义头像链接。
- 五子棋对局结束后双方确认再来一局，黑白互换。
- 默契试验场改为纯聊天房间，保留大厅入口。
- Web 与 MCP 共享同一套房间、聊天和重开能力。

本次不包含：

- 禁手、计时、悔棋、观战、AI 自动落子。
- 图片上传、图片裁剪、消息编辑或删除。
- 推送通知、WebSocket；继续使用 2.5 秒轮询。
- 持久化；服务重启后房间、聊天和凭证仍然全部丢失。
- 多于两人的房间。

## 2. 数据模型

### 2.1 玩家与聊天

```ts
export type Player = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type ChatMessage = {
  id: string;
  playerId: string;
  text: string;
  at: string; // ISO 8601
};
```

`avatarUrl` 可选，最长 500 字符，去除首尾空白；空字符串视为未设置。不校验协议，也不代理图片，前端加载失败时回退到默认头像。

聊天文本去除首尾空白后必须为 1–500 字符。聊天消息不可修改、不可删除。

### 2.2 房间

```ts
type Room = {
  id: string;
  game: GameDefinition;
  status: 'waiting' | 'active' | 'finished';
  version: number;
  revision: number;
  players: Player[];
  credentials: Map<string, string>;
  inviteToken: string;
  state: JsonObject;
  chat: ChatMessage[];
  rematchVotes: Set<string>;
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
```

- `version`：创建时为 1；加入、提交游戏动作、重开成功时 +1。`expectedVersion` 只与它比较。
- `revision`：任何房间变化都 +1，包括创建、加入、聊天、游戏动作、重开投票、重开成功。用于前端判断快照新旧。
- `chat`：只保留最近 200 条，按时间正序返回。聊天在等待、进行中、已结束状态下都可发送。
- `rematchVotes`：已投票的玩家 ID，始终返回；未结束或无人投票时为空数组。
- 进入新房间时 `version = 1`、`revision = 1`、`chat = []`、`rematchVotes = new Set()`。

聊天只改变 `revision`，不改变 `version`。这样对方说话不会让我方落子的 `expectedVersion` 失效。

### 2.3 游戏定义

```ts
export interface GameDefinition {
  id: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema?: ZodType<JsonObject>;
  initialState(players: Player[]): JsonObject;
  restart?(players: Player[], previousState: JsonObject): JsonObject;
  getPlayerView(state: JsonObject, context: GameContext): JsonObject;
  applyAction?(state: JsonObject, context: GameContext, action: JsonObject): {
    state: JsonObject;
    finished: boolean;
  };
}
```

- `initialState` 改为接收玩家列表，便于棋类分配先手。
- 没有 `actionSchema` 或 `applyAction` 的游戏是纯聊天房间；`submit_action` 返回 `INVALID_ACTION`，提示改用 `send_chat_message`。
- `restart` 可选；重开时优先调用它，否则调用 `initialState(players)`。

## 3. 五子棋

### 3.1 规则

- 棋盘 15×15，无禁手，黑先。
- 首局创建者执黑，另一位执白。
- 每方只能在自己的回合落一个空点。
- 横、竖、两条斜线任意方向连续五个或更多同色棋子即获胜。
- 棋盘 225 个点全部落满且无人获胜时判和。
- 获胜或和棋后房间状态变为 `finished`，不能再落子。
- 再来一局时黑白互换，棋盘清空，聊天保留。

### 3.2 状态

```ts
type Stone = 'black' | 'white';

type GomokuState = {
  board: (Stone | null)[][]; // 15 行 × 15 列
  blackPlayerId: string;
  whitePlayerId: string;
  turn: Stone;
  lastMove: { row: number; col: number; color: Stone } | null;
  moveCount: number;
  result:
    | { winnerColor: Stone; winningCells: [number, number][] }
    | { draw: true }
    | null;
};
```

`getPlayerView` 返回完整状态，并补充：

```ts
{ ...state, yourColor: 'black' | 'white' }
```

五子棋没有隐藏信息，双方看到同一个棋盘。

### 3.3 动作

```json
{ "type": "place", "row": 7, "col": 7 }
```

- `row`、`col` 为 0–14 的整数。
- 非当前回合、落点已有棋子：返回 `INVALID_ACTION`。
- 落子后从该点向横、竖、两条斜线统计连续同色棋子；任一方向达到 5 即获胜，`winningCells` 记录该方向经过的连续棋子坐标，供前端高亮。
- 无获胜且 `moveCount === 225` 时判和。
- 否则切换 `turn`。

### 3.4 重开

`restart(players, previousState)`：

- 从上一局状态读取黑、白玩家，交换颜色。
- 清空棋盘、`lastMove`、`result`，`moveCount = 0`，`turn = 'black'`。
- 若上一局玩家不在当前玩家列表中（理论上不会发生），退回 `players[0]` 执黑、`players[1]` 执白。

## 4. 默契试验场

改为纯聊天房间：

- 移除原来的 `message` 动作和 `state.messages`。
- 没有 `actionSchema` 和 `applyAction`。
- `initialState` 返回 `{}`，`getPlayerView` 原样返回。
- 仍为两人房间，状态在两人到齐后变为 `active`；没有结束条件。
- 聊天走统一的 `send_chat_message` / `POST /api/rooms/:roomId/chat`。

`list_games` 对它返回 `actionSchema: null`。MCP 指令明确说明：纯聊天房间不要调用 `submit_action`。

## 5. 房间操作

### 5.1 创建与加入

`create_room` 与 `join_room` 增加可选 `avatarUrl`。Web 创建弹窗增加可选的“头像链接”输入框；MCP 加入时也可携带。

创建者首局执黑由五子棋的 `initialState(players)` 决定：`players[0]` 执黑。

加入时：

- 状态、版本、修订号的更新与现在一致，额外将 `revision` +1。
- 新玩家进入 `players`，头像随玩家保存。

### 5.2 聊天

```ts
sendChat(input: { roomId; playerToken; text }): RoomView
```

- 鉴权后追加消息，`playerId` 由 `playerToken` 推导。
- `text` 去空白后 1–500 字符，否则 `INVALID_MESSAGE`。
- 新消息 `at` 使用服务端当前时间。
- `chat` 截断为最后 200 条。
- `revision` +1，`version` 不变。
- 任何房间状态下都允许发送，包括 `waiting` 和 `finished`。
- 聊天不需要 `expectedVersion`，不会产生版本冲突。

### 5.3 重开

```ts
requestRematch(input: { roomId; playerToken }): RoomView
```

- 只有 `finished` 状态可请求，否则 `ROOM_NOT_FINISHED`。
- 同一玩家重复请求是幂等的，不再增加投票，也不改变 `revision`。
- 投票记录进 `rematchVotes`，`revision` +1。
- 当前房间所有玩家都投票后：
  - 调用 `game.restart?.(players, state) ?? game.initialState(players)`。
  - `status = 'active'`，清空投票，`version` +1，`revision` +1。
  - 聊天记录保留。
- 纯聊天房间没有结束状态，因此无法请求重开。

## 6. 接口

### 6.1 MCP 工具

保留现有 `list_games`、`create_room`、`join_room`、`get_room`、`submit_action`，新增：

| 工具 | 输入 | 说明 |
| --- | --- | --- |
| `send_chat_message` | `roomId`, `playerToken`, `text` | 发送聊天，返回最新房间视图；不需要 `expectedVersion` |
| `request_rematch` | `roomId`, `playerToken` | 请求再来一局；双方都请求后自动重开 |

`create_room` / `join_room` 增加可选 `avatarUrl`。

MCP 指令更新：

- 聊天是房间通用能力，所有游戏都用 `send_chat_message`，不要再用 `submit_action` 发消息。
- 五子棋先调用 `list_games` 查看 `actionSchema`，再用最新 `version` 落子。
- 对局结束后任一玩家可调用 `request_rematch`，双方都请求才会重开。
- 聊天与落子可以交错进行；聊天不会让 `version` 变化。

### 6.2 REST

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| `POST` | `/api/rooms` | `{ gameId, playerName, avatarUrl? }` | `{ room, playerToken, inviteToken }` |
| `POST` | `/api/rooms/:roomId/join` | `{ inviteToken, playerName, avatarUrl? }` | `{ room, playerToken }` |
| `GET` | `/api/rooms/:roomId` | — | `RoomView` |
| `POST` | `/api/rooms/:roomId/actions` | `{ expectedVersion, action }` | `RoomView` |
| `POST` | `/api/rooms/:roomId/chat` | `{ text }` | `RoomView` |
| `POST` | `/api/rooms/:roomId/rematch` | — | `RoomView` |

错误映射新增：

- `INVALID_MESSAGE` → 400。
- `ROOM_NOT_FINISHED` → 409。

其余错误码与现有映射保持一致。

### 6.3 邀请指令

邀请指令改为通用版本，不再写死 sandbox 的 `message` 动作：

1. 调用 `join_room`，使用房间 ID 和邀请 token，保存返回的私有 `playerToken`。
2. 用 `get_room` 查看 `gameId`、局面和聊天。
3. 调用 `list_games`，按 `gameId` 找到当前游戏和 `actionSchema`。
4. 聊天用 `send_chat_message`；五子棋落子用 `submit_action`，以最新 `version` 作为 `expectedVersion`。
5. 不要重复加入、不要高速轮询，等用户指示再行动。

不再建议 Agent 自动发送固定的“你好”动作；是否先打招呼由 Agent 和用户决定。

## 7. 前端

### 7.1 大厅

- 游戏卡片按 `gomoku`、`sandbox` 顺序排列。五子棋卡片展示棋盘元素；默契试验场保持对话元素。
- 五子棋标签：`2 位玩家`、`15×15`、`轮流落子`；沙盒标签：`2 位玩家`、`自由聊天`、`无固定回合`。
- 移动端底部快捷按钮默认创建第一个游戏（五子棋）。
- 创建弹窗增加“头像链接（可选）”，长度上限 500。

### 7.2 房间页

房间页按 `gameId` 分支：

**五子棋**

- 顶部：对手头像、名字、黑白标识、最近一条对手消息的气泡。
- 中间：15×15 棋盘。当前回合时棋盘可点，非当前回合或未开始时不可点。
- 底部：自己头像、名字、黑白标识、最近一条自己消息的气泡，以及聊天输入框。
- 顶部栏提供“对话记录”入口，打开弹窗按时间正序显示全部聊天。
- 结束：棋盘上方显示“你赢了 / 你输了 / 平局”，高亮获胜连线，并提供“再来一局”按钮；已投票显示 `1 / 2`。
- 等待对手时：棋盘可见但禁用，保留邀请入口。
- 聊天在等待、对局中、结束后都可用；发送期间输入框禁用，避免草稿被覆盖。

**默契试验场**

- 顶部对手卡片、底部自己卡片，与五子棋保持一致的头像和气泡样式。
- 中间展示完整聊天记录，不再展示游戏动作。
- 使用同一个聊天输入框和“对话记录”弹窗。

**共用组件**

- `PlayerAvatar.vue`：有 `avatarUrl` 时显示图片，加载失败或无链接时显示默认头像/首字。
- `ChatComposer.vue`：输入、字数、发送中禁用、回车发送（触屏不劫持回车）。
- `ChatHistory`（放在房间页的弹窗内）：展示 `room.chat`。
- `GomokuBoard.vue`：SVG 画线，透明按钮网格承接点击；棋子用圆形绘制；落点与胜利连线按状态渲染。

### 7.3 前端数据流

- `RoomView` 直接包含 `chat`、`revision`、`rematchVotes`，轮询一次即可同步棋盘和聊天。
- `shouldAcceptRoom` 改为比较 `revision`，避免聊天响应乱序时旧快照覆盖新消息。
- `sendChat(text)`：调用聊天接口，不使用 `version`；成功后更新房间并清空草稿，失败保留草稿。
- `place(row, col)`：用当前 `room.version` 作为 `expectedVersion`；`VERSION_CONFLICT` 时刷新房间并提示。
- `requestRematch()`：调用重开接口，不使用 `expectedVersion`。
- 会话存储只需保留 `roomId`、`playerToken`、`playerName`、`inviteToken`；头像从 `room.players` 读取。
- 轮询间隔保持 2.5 秒；页面隐藏时暂停。

### 7.4 响应式

- 棋盘宽度 `min(100vw - 32px, 420px)`，正方形，页面不出现横向滚动。
- 390×844 为主要验收尺寸；320×568 下棋盘不得溢出，聊天和按钮仍可操作。
- 气泡只显示双方各自最近一条，内容过长时截断为两行，完整内容通过对话记录查看。
- 全部使用现有 CSS 变量与视觉语言，不引入 UI 框架。

## 8. 测试

### 8.1 房间层

- 聊天追加消息、`revision` +1、`version` 不变。
- 聊天文本去空白、空文本和超长文本返回 `INVALID_MESSAGE`。
- 聊天只保留最近 200 条。
- 未认证玩家不能聊天。
- 等待、进行中、已结束状态都能聊天。
- 重开只能在结束后请求；重复投票幂等；双方投票后棋盘重置、黑白互换、`version` +1、聊天保留。
- 头像随创建/加入保存，并通过房间视图返回。

### 8.2 五子棋 adapter

- 初始棋盘为空，创建者执黑，黑先。
- 非当前回合、已占落点返回 `INVALID_ACTION`。
- 落子后切换回合。
- 横、竖、两条斜线各自能够判定五连，`winningCells` 正确。
- 五连以上仍判胜。
- 棋盘下满且无五连判和。
- `restart` 清空棋盘并交换黑白。

### 8.3 MCP 与 Web API

- `list_games` 返回五子棋和纯聊天的默契试验场，后者 `actionSchema` 为 `null`。
- `send_chat_message` 与 `request_rematch` 出现在工具列表，输入校验正确。
- MCP 与 Web 交替聊天、落子，双方都能通过 `get_room` 看到相同聊天。
- 聊天不改变 `version`；落子仍受 `expectedVersion` 保护。
- REST 聊天与重开鉴权、错误码、状态码正确。
- 原有跨端不泄露 `playerToken` 的断言继续通过。

### 8.4 前端逻辑与浏览器

- `shouldAcceptRoom` 按 `revision` 接受快照，旧快照被拒绝。
- 邀请指令不再包含 sandbox 的 `message` 动作。
- 浏览器真实流程：创建五子棋房间 → MCP Agent 加入 → 边下边聊 → 五连结束 → 双方请求重开 → 黑白互换且聊天保留。
- 390×844、320×568、1440×1000 无横向溢出、无控制台错误；聊天发送期间草稿不丢，离开房间再回来草稿仍在。

## 9. 验收标准

- 大厅同时看到五子棋和默契试验场，两个入口都能创建房间。
- 五子棋能完整下完一局，轮流、胜负、和棋、结束状态正确。
- 双方在等待、对局中、结束后都能聊天，聊天不会导致落子版本冲突。
- 聊天记录跨重开保留，最多 200 条；每侧最近一条以气泡显示，历史入口可查看全部。
- 双方请求后重开成功，黑白互换。
- 默契试验场不再依赖游戏动作，聊天能力与其他游戏一致。
- `npm test`、`npm run typecheck`、`npm run build` 全部通过。

## 10. 风险与取舍

- 房间视图包含 200 条聊天和 15×15 棋盘，每次轮询数据量约数 KB；本地自用可以接受，暂不做增量协议。
- 2.5 秒轮询意味着对方消息最多延迟约 2.5 秒；先用轮询保持实现简单，若体验不足再考虑 SSE。
- 聊天与游戏动作共享房间锁（单进程内存），并发安全依赖同步执行；与现有模型一致。
- 重开换色依赖游戏自己的 `restart`；其他游戏不实现时回到默认初始状态。
- 纯聊天房间没有动作，`submit_action` 对新 Agent 可能造成困惑；通过 `actionSchema: null`、工具描述和邀请指令三处说明。
