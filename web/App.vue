<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import AppIcon from './components/AppIcon.vue';
import AppDialog from './components/AppDialog.vue';
import LobbyPage from './components/LobbyPage.vue';
import RoomPage from './components/RoomPage.vue';
import ConnectionGuide from './components/ConnectionGuide.vue';
import { usePlayground } from './lib/usePlayground.ts';
import { buildInvitation } from './lib/session.ts';
import type { GameInfo } from './lib/types.ts';

const { games, gamesLoading, gamesError, session, room, page, roomLoading, roomError, sendError, storageNotice, expired, sending, creating, loadGames, refreshRoom, createRoom, sendChat, place, requestRematch } = usePlayground();
const dialog = ref<'create' | 'guide' | 'invite' | null>(null);
const selectedGame = ref<GameInfo | null>(null);
const playerName = ref(session.value?.playerName ?? '');
const avatarUrl = ref('');
const createError = ref('');
const copied = ref(false);
const copyError = ref('');
const invitationField = ref<HTMLTextAreaElement>();
const invitation = computed(() => session.value ? buildInvitation(session.value) : '');

function updateViewport() {
  document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
}
onMounted(() => {
  updateViewport();
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.addEventListener('resize', updateViewport);
});
onUnmounted(() => {
  window.visualViewport?.removeEventListener('resize', updateViewport);
  window.removeEventListener('resize', updateViewport);
});

function openCreate(game: GameInfo) {
  selectedGame.value = game;
  createError.value = '';
  dialog.value = 'create';
}
async function confirmCreate() {
  if (!selectedGame.value || !playerName.value.trim() || creating.value) return;
  try {
    await createRoom(selectedGame.value.id, playerName.value, avatarUrl.value);
    dialog.value = null;
  } catch (error) { createError.value = (error as Error).message; }
}
function openInvite() {
  copied.value = false;
  copyError.value = '';
  dialog.value = 'invite';
}
async function copyInvitation() {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(invitation.value);
    } else {
      invitationField.value?.focus();
      invitationField.value?.select();
      if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    }
    copied.value = true;
    copyError.value = '';
  } catch {
    invitationField.value?.focus();
    invitationField.value?.select();
    copyError.value = '浏览器限制了复制，已选中指令。请长按或使用系统复制。';
  }
}
</script>

<template>
  <div class="app-shell" :class="{ 'in-room': page === 'room' }">
    <header class="site-header"><div class="header-inner page-width"><button class="brand" aria-label="同游，返回游戏大厅" @click="page = 'lobby'"><span class="brand-mark"><i></i><i></i></span><strong>同游</strong><span class="brand-subtitle">PLAY WITH AI</span></button><nav aria-label="主导航"><button :class="{ active: page === 'lobby' }" @click="page = 'lobby'">游戏大厅</button><button @click="dialog = 'guide'">连接指南 <AppIcon name="arrow" :size="14" /></button></nav><span class="local-label"><i></i> 本地游乐场</span></div></header>
    <div v-if="storageNotice" class="storage-notice page-width" role="status">{{ storageNotice }}</div>
    <LobbyPage v-if="page === 'lobby'" :games="games" :loading="gamesLoading" :error="gamesError" :has-room="!!session && !expired" @create="openCreate" @resume="page = 'room'" @guide="dialog = 'guide'" @retry="loadGames" />
    <RoomPage v-if="session" v-show="page === 'room'" :key="session.roomId" :room="room" :session="session" :loading="roomLoading" :error="roomError" :send-error="sendError" :sending="sending" :expired="expired" :send-chat="sendChat" :place="place" :request-rematch="requestRematch" @back="page = 'lobby'" @invite="openInvite" @guide="dialog = 'guide'" @retry="refreshRoom" />

    <AppDialog v-if="dialog === 'create'" title="给这场同游，留一个位置" :dismissible="!creating" @close="dialog = null">
      <div class="create-game-preview"><span><AppIcon name="spark" :size="26" /></span><div><strong>{{ selectedGame?.id === 'sandbox' ? '默契试验场' : selectedGame?.title }}</strong><p>{{ selectedGame?.id === 'gomoku' ? '双人五子棋 · 15×15 · 可聊天' : '双人互动 · 自由聊天 · 不计输赢' }}</p></div></div>
      <form @submit.prevent="confirmCreate"><label class="form-label" for="player-name">怎么称呼你？<span>{{ playerName.length }} / 40</span></label><input id="player-name" v-model="playerName" class="text-input" name="nickname" autocomplete="nickname" placeholder="给自己起一个名字" maxlength="40" required autofocus :disabled="creating" /><p class="field-hint">这是另一位玩家在房间里看到的名字。</p><label class="form-label avatar-field-label" for="avatar-url">头像链接（可选）<span>{{ avatarUrl.length }} / 500</span></label><input id="avatar-url" v-model="avatarUrl" class="text-input" name="avatar-url" autocomplete="off" inputmode="url" placeholder="https://…" maxlength="500" :disabled="creating" /><p class="field-hint">没有链接也可以，默认用名字首字。</p><p v-if="session && !expired" class="form-warning">创建新房间会替换当前标签页保存的房间凭证。想继续之前的互动，可以关闭弹窗回到原房间。</p><p v-if="createError" class="form-error" role="alert">{{ createError }}</p><button class="button primary full-width create-submit" type="submit" :disabled="!playerName.trim() || creating"><span v-if="creating" class="spinner"></span>{{ creating ? '正在准备房间…' : '创建房间，邀请 AI' }}<AppIcon v-if="!creating" name="arrow" :size="18" /></button></form>
      <div class="dialog-footnote"><AppIcon name="shield" :size="15" /> 无需注册，房间仅保存在当前服务中</div>
    </AppDialog>

    <AppDialog v-if="dialog === 'guide'" title="把你的 AI 带过来" wide @close="dialog = null"><ConnectionGuide /></AppDialog>
    <AppDialog v-if="dialog === 'invite' && session" title="把这个空位，留给你的 AI" wide @close="dialog = null"><p class="invite-intro">将下方指令粘贴给已配置 MCP 的 Agent。<br />它会加入这个房间，和你打个招呼。</p><div class="invite-room-label"><span class="status-pill"><i></i> 房间邀请</span><span>{{ session.roomId.slice(0, 8).toUpperCase() }}</span></div><textarea id="agent-invitation" name="agent-invitation" ref="invitationField" class="invitation-text" readonly :value="invitation" aria-label="Agent 邀请指令" spellcheck="false"></textarea><p v-if="copyError" class="form-error" role="status">{{ copyError }}</p><button class="button primary full-width" @click="copyInvitation"><AppIcon :name="copied ? 'check' : 'copy'" :size="18" />{{ copied ? '已复制，去邀请你的 AI 吧' : '复制邀请指令' }}</button><div class="invite-help"><span>还没配好 MCP？</span><button class="text-button" @click="dialog = 'guide'">查看连接指南 <AppIcon name="arrow" :size="14" /></button></div><div class="privacy-note"><AppIcon name="shield" :size="19" /><p>这里没有你的玩家密钥。只把邀请发给你希望加入房间的 Agent。</p></div></AppDialog>
  </div>
</template>
