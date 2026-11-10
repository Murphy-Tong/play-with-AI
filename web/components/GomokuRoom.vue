<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
import ChatComposer from './ChatComposer.vue';
import ChatHistory from './ChatHistory.vue';
import GomokuBoard from './GomokuBoard.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import type { ChatMessage, GomokuView, RoomSession, RoomView } from '../lib/types.ts';

const props = defineProps<{
  room: RoomView;
  session: RoomSession;
  error: string;
  sendError: string;
  sending: boolean;
  expired: boolean;
  sendChat: (text: string) => Promise<boolean>;
  place: (row: number, col: number) => Promise<boolean>;
  requestRematch: () => Promise<boolean>;
  kick: (playerId: string) => Promise<boolean>;
  invite: () => void;
}>();
const emit = defineEmits<{ retry: [] }>();
const draft = ref('');
const historyOpen = ref(false);
const state = computed(() => props.room.state as unknown as GomokuView);
const winningCells = computed(() => {
  const result = state.value.result;
  return result && 'winnerColor' in result ? result.winningCells : null;
});
const me = computed(() => props.room.players.find((player) => player.id === props.room.selfPlayerId));
const opponent = computed(() => props.room.players.find((player) => player.id !== props.room.selfPlayerId));
const isHost = computed(() => props.room.hostId === props.room.selfPlayerId);
const myColor = computed(() => state.value.yourColor);
const opponentColor = computed(() => myColor.value === 'black' ? 'white' : 'black');
const myTurn = computed(() => props.room.status === 'active' && !state.value.result && state.value.turn === myColor.value);
const boardDisabled = computed(() => props.expired || props.sending || !myTurn.value);
const resultText = computed(() => {
  const result = state.value.result;
  if (!result) return '';
  if ('draw' in result) return '平局';
  return result.winnerColor === myColor.value ? '你赢了' : '你输了';
});
const statusText = computed(() => {
  if (props.expired) return '房间已失效';
  if (props.error) return '连接中断';
  if (props.room.status === 'waiting') return '等待对手入座';
  if (state.value.result) return '对局结束，还能聊聊';
  return myTurn.value ? '轮到你落子' : '等对方落子';
});
const composerDisabled = computed(() => props.expired || props.sending);

type Bubble = { id: string; name: string; text: string; self: boolean };
const bubbles = ref<Bubble[]>([]);
const knownIds = new Set(props.room.chat.map((message) => message.id));
const bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function dismissBubble(id: string) {
  const timer = bubbleTimers.get(id);
  if (timer) clearTimeout(timer);
  bubbleTimers.delete(id);
  bubbles.value = bubbles.value.filter((bubble) => bubble.id !== id);
}

function showBubble(message: ChatMessage) {
  const player = props.room.players.find((candidate) => candidate.id === message.playerId);
  bubbles.value = [...bubbles.value, {
    id: message.id,
    name: player?.name ?? '玩家',
    text: message.text,
    self: message.playerId === props.room.selfPlayerId,
  }].slice(-3);
  bubbleTimers.set(message.id, setTimeout(() => dismissBubble(message.id), 3600));
}

watch(() => props.room.chat, (chat) => {
  for (const message of chat) {
    if (knownIds.has(message.id)) continue;
    knownIds.add(message.id);
    showBubble(message);
  }
}, { deep: true });

onUnmounted(() => {
  for (const timer of bubbleTimers.values()) clearTimeout(timer);
  bubbleTimers.clear();
});

async function send() {
  if (composerDisabled.value || !draft.value.trim()) return;
  if (await props.sendChat(draft.value.trim())) draft.value = '';
}
function place(row: number, col: number) {
  if (!myTurn.value || props.sending || props.expired) return;
  void props.place(row, col);
}
const rematchOpen = ref(false);
function askRematch() {
  if (props.expired || props.sending) return;
  if (state.value.result || state.value.moveCount === 0) void props.requestRematch();
  else rematchOpen.value = true;
}
async function confirmRematch() {
  if (await props.requestRematch()) rematchOpen.value = false;
}
</script>

<template>
  <section class="gomoku-room" aria-label="五子棋房间">
    <div v-if="error" class="room-error" role="alert">
      <AppIcon name="info" :size="18" /><span>{{ error }}</span>
      <button v-if="!expired" class="text-button" @click="emit('retry')">重试</button>
    </div>

    <div class="gomoku-player gomoku-player-top">
      <PlayerAvatar :player="opponent" ai />
      <div class="gomoku-player-copy">
        <div class="gomoku-player-name">
          <strong>{{ opponent?.name ?? '留给你的 AI' }}</strong>
          <span v-if="opponent" class="stone-tag" :class="`stone-tag-${opponentColor}`"></span>
          <span v-if="opponent && !isHost" class="host-tag">房主</span>
        </div>
      </div>
      <button v-if="opponent && isHost && !expired" class="text-button kick-button" :disabled="sending" @click="props.kick(opponent.id)">请离席</button>
      <button v-if="opponent && !expired && (state.moveCount > 0 || !!state.result)" class="text-button rematch-button" :disabled="sending" @click="askRematch">再来一局</button>
      <button class="text-button history-button" @click="historyOpen = true">对话记录</button>
    </div>

    <div class="gomoku-stage">
      <div class="gomoku-status" :class="{ mine: myTurn }"><i></i>{{ statusText }}</div>
      <div class="gomoku-bubble-layer" aria-live="polite" aria-atomic="false">
        <div v-for="bubble in bubbles" :key="bubble.id" class="gomoku-bubble" :class="{ self: bubble.self }">
          <span class="gomoku-bubble-name">{{ bubble.name }}</span>{{ bubble.text }}
        </div>
      </div>
      <GomokuBoard
        :board="state.board" :last-move="state.lastMove"
        :winning-cells="winningCells"
        :disabled="boardDisabled" @place="place"
      />
      <div v-if="state.result" class="gomoku-result">
        <strong>{{ resultText }}</strong>
        <button class="button primary" :disabled="sending" @click="askRematch">再来一局</button>
      </div>
    </div>

    <div class="gomoku-player gomoku-player-bottom">
      <PlayerAvatar :player="me" :fallback-name="session.playerName" />
      <div class="gomoku-player-copy">
        <div class="gomoku-player-name">
          <strong>{{ me?.name ?? session.playerName }}</strong>
          <span class="stone-tag" :class="`stone-tag-${myColor}`"></span>
          <span v-if="isHost" class="host-tag">房主</span>
          <span class="you-tag">你</span>
        </div>
      </div>
    </div>

    <p v-if="sendError" class="send-error" role="alert">{{ sendError }}</p>
    <ChatComposer
      v-model="draft" :disabled="composerDisabled" :sending="sending"
      :placeholder="room.status === 'waiting' ? '先留一句问候，等对方入座…' : '边下边聊，说点什么…'"
      @send="send"
    />
    <button v-if="!opponent && !expired && session.inviteToken" class="button secondary invite-inline" @click="invite">
      <AppIcon name="link" :size="17" /> 邀请我的 AI
    </button>

    <AppDialog v-if="historyOpen" title="对话记录" wide @close="historyOpen = false">
      <ChatHistory :room="room" />
    </AppDialog>

    <AppDialog v-if="rematchOpen" title="重新开始一局？" @close="rematchOpen = false">
      <p class="rematch-confirm-text">棋盘会清空，已经落下的棋子不会保留。</p>
      <div class="rematch-confirm-actions">
        <button class="button secondary" @click="rematchOpen = false">继续这局</button>
        <button class="button primary" :disabled="sending" @click="confirmRematch">再来一局</button>
      </div>
    </AppDialog>
  </section>
</template>
