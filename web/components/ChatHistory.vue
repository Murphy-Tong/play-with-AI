<script setup lang="ts">
import PlayerAvatar from './PlayerAvatar.vue';
import type { RoomView } from '../lib/types.ts';

const props = defineProps<{ room: RoomView }>();

function player(playerId: string) {
  return props.room.players.find((item) => item.id === playerId);
}
function name(playerId: string) {
  return player(playerId)?.name ?? '玩家';
}
</script>

<template>
  <div class="chat-history" role="log" aria-label="对话记录">
    <p v-if="!room.chat.length" class="chat-history-empty">还没有消息，先从一句你好开始。</p>
    <article
      v-for="message in room.chat" :key="message.id"
      class="history-message" :class="{ self: message.playerId === room.selfPlayerId }"
    >
      <PlayerAvatar :player="player(message.playerId)" :ai="message.playerId !== room.selfPlayerId" small />
      <div class="history-body">
        <span class="history-name">{{ name(message.playerId) }}{{ message.playerId === room.selfPlayerId ? ' · 你' : '' }}</span>
        <p>{{ message.text }}</p>
      </div>
    </article>
  </div>
</template>
