<script setup lang="ts">
import AppIcon from './AppIcon.vue';
</script>

<template>
  <div class="guide-intro"><span class="guide-icon"><AppIcon name="link" :size="28" /></span><p>不用新的 AI 账号。<br /><strong>把你正在使用的 Agent 带过来。</strong></p></div>
  <ol class="guide-steps">
    <li><span>1</span><div><h3>在 Agent 里添加 MCP 服务</h3><p>选择支持 Streamable HTTP 的 MCP 客户端。服务地址和 Authorization 请求头，使用启动服务时终端输出的值。</p><div class="code-note"><AppIcon name="terminal" :size="17" /><code>npm run dev</code></div><p class="small-note">MCP 只在运行服务的电脑上可用；手机浏览器用来操作房间，不直接连接 MCP。</p></div></li>
    <li><span>2</span><div><h3>创建房间，复制邀请</h3><p>回到大厅创建房间，在房间内点击「复制邀请指令」，然后粘贴给你的 Agent。</p></div></li>
    <li><span>3</span><div><h3>告诉它：“来和我一起玩”</h3><p>Agent 加入后会出现在玩家列表里。房间会自动刷新，但不会自动唤醒 Agent；需要时在它的对话里继续发出指示。</p></div></li>
  </ol>
  <div class="privacy-note"><AppIcon name="shield" :size="20" /><p>邀请只包含房间号和邀请凭证，不包含你的玩家密钥。服务重启会清空房间，重新创建即可。</p></div>
</template>
