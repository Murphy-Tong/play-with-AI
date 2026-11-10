<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { RoomSession, RoomView } from '../lib/types.ts';

const props = defineProps<{
  room: RoomView | null;
  session: RoomSession;
  error: string;
  sendError: string;
  loading: boolean;
  sending: boolean;
  expired: boolean;
  sendMessage: (text: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ back: []; invite: []; guide: []; retry: [] }>();
const draft = ref('');
const conversation = ref<HTMLElement>();
const input = ref<HTMLTextAreaElement>();
const nearBottom = ref(true);
const messages = computed(() => (props.room?.state.messages ?? []) as { playerId: string; text: string }[]);
const otherPlayer = computed(() => props.room?.players.find((player) => player.id !== props.room?.selfPlayerId));
const canSend = computed(() => props.room?.status === 'active' && !props.expired && !props.sending && !!draft.value.trim());
const statusText = computed(() => props.expired ? '房间已失效' : props.error ? '连接中断' : props.room?.status === 'active' ? '一起玩，已就位' : props.room?.status === 'finished' ? '互动已结束' : '等待另一位玩家');

function resizeInput() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(input.value.scrollHeight, 128)}px`;
}
async function send() {
  if (!canSend.value) return;
  if (await props.sendMessage(draft.value.trim())) {
    draft.value = '';
    nearBottom.value = true;
    await nextTick();
    resizeInput();
    if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight;
  }
}
function onScroll() {
  const list = conversation.value;
  if (list) nearBottom.value = list.scrollHeight - list.scrollTop - list.clientHeight < 100;
}
function onEnter(event: KeyboardEvent) {
  if (!event.isComposing && !('ontouchstart' in window)) {
    event.preventDefault();
    void send();
  }
}
watch(() => props.room?.version, async () => {
  if (!nearBottom.value) return;
  await nextTick();
  if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight;
});
</script>

<template>
  <main class="room-page page-width">
    <div class="room-heading"><button class="text-button back-button" @click="emit('back')"><AppIcon name="back" :size="17" /> 游戏大厅</button><span class="eyebrow">YOUR SHARED LITTLE SPACE</span></div>
    <div class="room-layout">
      <aside class="room-sidebar">
        <div class="room-summary"><span class="eyebrow">SANDBOX / 01</span><h1>默契试验场</h1><p>同一个房间，两个有趣的灵魂。</p><span class="status-pill" :class="{ warning: !!error || expired }"><i></i>{{ statusText }}</span></div>
        <div class="players-panel"><div class="panel-label">这张桌上的玩家 <span>{{ room?.players.length ?? 1 }} / 2</span></div>
          <div class="player-row"><span class="avatar avatar-human"><span class="avatar-eyes">··</span></span><div><strong>{{ session.playerName }}</strong><span>准备好出发了</span></div><span class="you-tag">你</span></div>
          <div class="player-row"><span class="avatar" :class="otherPlayer ? 'avatar-ai' : 'avatar-empty'"><AppIcon :name="otherPlayer ? 'spark' : 'plus'" :size="23" /></span><div><strong>{{ otherPlayer?.name ?? '留给你的 AI' }}</strong><span>{{ otherPlayer ? '已加入房间' : '一个空位，一点期待' }}</span></div><span v-if="otherPlayer" class="online-dot"></span></div>
        </div>
        <button v-if="!otherPlayer && !expired && session.inviteToken" class="button primary invite-sidebar-button" @click="emit('invite')"><AppIcon name="copy" :size="17" /> 复制邀请指令</button>
        <div class="room-tips"><AppIcon name="info" :size="18" /><p>这里是消息互动沙盒，不计输赢。<br />Agent 需要你在它的对话里发出指示，不会自动回复。</p></div>
        <button class="text-button room-guide-link" @click="emit('guide')">连接指南 <AppIcon name="arrow" :size="15" /></button>
        <div class="room-id"><span>ROOM ID</span><code>{{ session.roomId }}</code></div>
      </aside>

      <section class="conversation-panel" aria-label="房间互动">
        <div class="conversation-header"><div><AppIcon name="spark" :size="19" /><strong>同游进行时</strong></div><span>{{ room?.status === 'active' ? '每 2.5 秒同步' : '从一句你好开始' }}</span></div>
        <div v-if="error" class="room-error" role="alert"><AppIcon name="info" :size="18" /><span>{{ error }}</span><button v-if="!expired" class="text-button" @click="emit('retry')">重试</button><button v-else class="text-button" @click="emit('back')">回大厅</button></div>
        <div ref="conversation" class="conversation-scroll" role="log" aria-label="消息记录" aria-live="polite" aria-relevant="additions" @scroll="onScroll">
          <div v-if="loading && !room" class="conversation-empty"><span class="spinner"></span><h2>正在找回你的房间</h2><p>给我们一点时间，座位还在。</p></div>
          <div v-else-if="!messages.length" class="conversation-empty"><div class="empty-illustration" aria-hidden="true"><span class="empty-face face-you">··</span><span class="empty-face face-ai"><AppIcon name="spark" :size="30" /></span><span class="empty-connection">···</span></div><span class="eyebrow">{{ otherPlayer ? 'SAY YOUR FIRST HELLO' : 'GOOD THINGS TAKE TWO' }}</span><h2>{{ expired ? '这一场，先到这里' : otherPlayer ? '人到齐了，打个招呼吧' : '另一位玩家，正在路上' }}</h2><p>{{ expired ? '服务重启或凭证失效了。回到大厅，开始新的一场。' : otherPlayer ? '没有固定剧本，第一句话由你决定。' : '把邀请发给你的 AI，让它来这里找你。' }}</p><button v-if="!otherPlayer && !expired && session.inviteToken" class="button secondary" @click="emit('invite')"><AppIcon name="link" :size="17" /> 邀请我的 AI</button></div>
          <template v-else><div class="conversation-start">一场新的同游，从这里开始</div><article v-for="(message, index) in messages" :key="`${index}-${message.playerId}-${message.text}`" class="message" :class="{ 'message-self': message.playerId === room?.selfPlayerId }"><span class="message-avatar" :class="message.playerId === room?.selfPlayerId ? 'avatar-human' : 'avatar-ai'"><AppIcon v-if="message.playerId !== room?.selfPlayerId" name="spark" :size="17" /><span v-else>··</span></span><div class="message-body"><span class="message-name">{{ room?.players.find((player) => player.id === message.playerId)?.name ?? '玩家' }}{{ message.playerId === room?.selfPlayerId ? ' · 你' : '' }}</span><p>{{ message.text }}</p></div></article></template>
        </div>
        <form class="composer" @submit.prevent="send">
          <p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
          <div class="composer-box"><textarea id="message-draft" name="message" ref="input" v-model="draft" rows="1" maxlength="2000" aria-label="发送给另一位玩家的消息" :placeholder="room?.status === 'active' ? '说点什么，让同游开始…' : '等另一位玩家加入后，就能开始聊天'" :disabled="room?.status !== 'active' || expired || sending" @input="resizeInput" @keydown.enter.exact="onEnter"></textarea><button class="send-button" type="submit" :disabled="!canSend" aria-label="发送消息"><span v-if="sending" class="spinner"></span><AppIcon v-else name="send" :size="21" /></button></div>
          <div class="composer-caption"><span>你的消息只在这个房间里可见</span><span>{{ draft.length }} / 2000</span></div>
        </form>
      </section>
    </div>
  </main>
</template>
