<script setup lang="ts">
import { ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { Player } from '../lib/types.ts';

const props = defineProps<{
  player?: Player;
  fallbackName?: string;
  ai?: boolean;
  small?: boolean;
}>();
const failed = ref(false);
watch(() => props.player?.avatarUrl, () => { failed.value = false; });
</script>

<template>
  <span class="player-avatar" :class="{ 'avatar-ai': ai, 'avatar-human': !ai, 'is-small': small }">
    <img v-if="player?.avatarUrl && !failed" :src="player.avatarUrl" :alt="`${player.name} 的头像`" @error="failed = true" />
    <AppIcon v-else-if="ai" name="spark" :size="small ? 17 : 22" />
    <span v-else class="avatar-letter">{{ (player?.name ?? fallbackName ?? '?').trim().slice(0, 1) }}</span>
  </span>
</template>
