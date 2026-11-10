<script setup lang="ts">
import { computed, ref } from 'vue';
import AppDialog from './AppDialog.vue';
import AppIcon from './AppIcon.vue';
import ChatComposer from './ChatComposer.vue';
import ChatHistory from './ChatHistory.vue';
import GomokuBoard from './GomokuBoard.vue';
import PlayerAvatar from './PlayerAvatar.vue';
import type { GomokuView, RoomSession, RoomView } from '../lib/types.ts';

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
const lastMine = computed(() => [...props.room.chat].reverse().find((message) => message.playerId === props.room.selfPlayerId));
const lastOpponent = computed(() => [...props.room.chat].reverse().find((message) => message.playerId !== props.room.selfPlayerId));
const myColor = computed(() => state.value.yourColor);
const opponentColor = computed(() => myColor.value === 'black' ? 'white' : 'black');
const myTurn = computed(() => props.room.status === 'active' && !state.value.result && state.value.turn === myColor.value);
const boardDisabled = computed(() => props.expired || props.sending || !myTurn.value);
const voted = computed(() => props.room.rematchVotes.includes(props.room.selfPlayerId));
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

async function send() {
  if (composerDisabled.value || !draft.value.trim()) return;
  if (await props.sendChat(draft.value.trim())) draft.value = '';
}
function place(row: number, col: number) {
  if (!myTurn.value || props.sending || props.expired) return;
  void props.place(row, col);
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
        </div>
        <p v-if="lastOpponent" class="chat-bubble">{{ lastOpponent.text }}</p>
        <p v-else class="chat-bubble chat-bubble-empty">{{ opponent ? '还没有消息' : '邀请你的 AI 来下棋' }}</p>
      </div>
      <button class="text-button history-button" @click="historyOpen = true">对话记录</button>
    </div>

    <div class="gomoku-stage">
      <div class="gomoku-status" :class="{ mine: myTurn }"><i></i>{{ statusText }}</div>
      <GomokuBoard
        :board="state.board" :last-move="state.lastMove"
        :winning-cells="winningCells"
        :disabled="boardDisabled" @place="place"
      />
      <div v-if="state.result" class="gomoku-result">
        <strong>{{ resultText }}</strong>
        <button class="button primary" :disabled="sending" @click="requestRematch">
          {{ voted ? '已请求，等对方' : '再来一局' }}
          <span class="rematch-count">{{ room.rematchVotes.length }} / 2</span>
        </button>
      </div>
    </div>

    <div class="gomoku-player gomoku-player-bottom">
      <PlayerAvatar :player="me" :fallback-name="session.playerName" />
      <div class="gomoku-player-copy">
        <div class="gomoku-player-name">
          <strong>{{ me?.name ?? session.playerName }}</strong>
          <span class="stone-tag" :class="`stone-tag-${myColor}`"></span>
          <span class="you-tag">你</span>
        </div>
        <p v-if="lastMine" class="chat-bubble chat-bubble-self">{{ lastMine.text }}</p>
        <p v-else class="chat-bubble chat-bubble-empty">{{ room.status === 'waiting' ? '先留一句话，等对方入座' : '边下边聊，说点什么' }}</p>
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
  </section>
</template>
