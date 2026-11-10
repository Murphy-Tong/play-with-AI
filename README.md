# play-with-AI

一个人打开，两个人开玩。

人类在浏览器里，AI 通过 MCP 坐到同一张桌子前——边下棋，边聊天。不用换一个助手，只换一种相处方式。

- **人类**：Vue 3 写的移动端优先网页
- **AI**：任何支持 MCP（Streamable HTTP）的客户端，不绑定 provider
- **数据**：全部在内存里，重启服务即清空

## 有什么可玩

| 游戏 | 说明 |
| --- | --- |
| 五子棋 | 15×15 无禁手，房主执黑先行，五子连珠获胜，支持双方确认后重开并交换黑白 |
| 默契试验场 | 纯聊天房间，用来先打个招呼、找点默契 |

聊天是**房间级能力**，每个游戏都有：聊天不占回合，也不会改变棋局版本。

## 快速开始

需要 Node.js 24 或更高版本。

```bash
git clone https://github.com/Murphy-Tong/play-with-AI.git
cd play-with-AI
npm install
npm run dev
```

启动后会输出一段 JSON：

```json
{
  "url": "http://127.0.0.1:3001/mcp",
  "web": "http://127.0.0.1:3001",
  "transport": "streamable-http",
  "storage": "in-memory; restarting clears rooms"
}
```

浏览器打开 `web` 地址，选个游戏、填个昵称（头像链接可选），创建房间。然后把页面给出的邀请指令交给 AI。

MCP 端点不需要任何 token，填上地址就能连。

### 把 AI 接进来

Claude Code：

```bash
claude mcp add --transport http play-with-ai http://127.0.0.1:3001/mcp
```

通用 MCP 客户端配置：

```json
{
  "mcpServers": {
    "play-with-ai": {
      "type": "http",
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

接入后让 AI 先调 `list_games`，再 `join_room`，只把 `roomId` 和 `inviteToken` 交给对方；自己的 `playerToken` 留在本地，断了用 `get_room` 恢复座位。

## MCP 工具

| 工具 | 作用 |
| --- | --- |
| `list_games` | 查看可用游戏、人数上限、规则与 `actionSchema`（纯聊天房间为 `null`） |
| `create_room` | 创建房间并占据第一个座位，返回私密 `playerToken` 和可分享的 `inviteToken` |
| `join_room` | 用邀请入座，返回自己的房间视图和 `playerToken` |
| `get_room` | 读取自己的房间视图：状态、版本、玩家列表、当前局面 |
| `submit_action` | 按 `actionSchema` 提交游戏动作，需要带上最新 `expectedVersion` |
| `send_chat_message` | 发送房间聊天，任何游戏都可用，不需要 `expectedVersion` |
| `request_rematch` | 对局结束后申请重开，双方都申请才会重新开始 |

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端口，`0`–`65535` |
| `--dev` | 关闭 | 开发模式，挂 Vite 中间件并热更新 |
| `--lan` | 关闭 | 让网页在局域网可访问；MCP 端点仍然只接受本机回环请求 |

`--lan` 只适合可信网络：同一网络下的其他人可以打开网页并操作房间。

## 开发与测试

```bash
npm run dev          # 开发模式，改动服务端自动重启，前端热更新
npm run build        # 产出 dist/（服务端）和 dist/web（前端静态资源）
npm start            # 以构建产物启动
npm test             # 后端、Web API、MCP 与前端会话测试
npm run typecheck    # 服务端与前端类型检查
```

目录结构：

```text
src/            服务端：HTTP、MCP、房间存储与游戏适配器
src/games/      游戏规则（gomoku、sandbox）
web/            Vue 3 前端：大厅、房间、棋盘、聊天
test/           node:test 测试
dist/           构建产物
```
