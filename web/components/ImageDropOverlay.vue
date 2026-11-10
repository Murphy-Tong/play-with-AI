<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { ImageDrop, RoomView } from '../lib/types.ts';

const props = defineProps<{ room: RoomView | null }>();

type Phase = 'loading' | 'falling' | 'impact' | 'leaving';

const reducedMotion = typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const active = ref<ImageDrop | null>(null);
const phase = ref<Phase>('loading');
const seen = new Set<string>();
const queue: ImageDrop[] = [];
let seenRoomId: string | null = null;
let timers: number[] = [];

const dropperName = computed(() => {
  const drop = active.value;
  return drop ? props.room?.players.find((player) => player.id === drop.playerId)?.name ?? '玩家' : '';
});
const caption = computed(() => {
  const drop = active.value;
  if (!drop) return '';
  return drop.caption ? `${dropperName.value} · ${drop.caption}` : `${dropperName.value} 投下了一张图片`;
});
const shards = [0, 45, 90, 135, 180, 225, 270, 315];

function after(ms: number, run: () => void) {
  const timer = window.setTimeout(run, ms);
  timers.push(timer);
}
function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers = [];
}
function reset() {
  clearTimers();
  active.value = null;
  queue.length = 0;
  seen.clear();
  seenRoomId = null;
}
function enqueue(drop: ImageDrop) {
  queue.length = 0;
  queue.push(drop);
  playNext();
}
function playNext() {
  if (active.value || !queue.length) return;
  const drop = queue.shift()!;
  active.value = drop;
  phase.value = 'loading';
  after(4000, () => {
    if (active.value?.id === drop.id && phase.value === 'loading') finish();
  });
}
function onLoad() {
  if (!active.value || phase.value !== 'loading') return;
  clearTimers();
  phase.value = 'falling';
  after(reducedMotion ? 0 : 620, () => {
    phase.value = 'impact';
    after(reducedMotion ? 900 : 1500, () => {
      phase.value = 'leaving';
      after(reducedMotion ? 220 : 420, finish);
    });
  });
}
function finish() {
  clearTimers();
  active.value = null;
  playNext();
}

watch(() => props.room, (room) => {
  if (!room) {
    reset();
    return;
  }
  if (room.id !== seenRoomId) {
    clearTimers();
    seenRoomId = room.id;
    seen.clear();
    queue.length = 0;
    active.value = null;
    room.imageDrops.forEach((drop) => seen.add(drop.id));
    return;
  }
  const fresh = room.imageDrops.filter((drop) => !seen.has(drop.id));
  if (!fresh.length) return;
  fresh.forEach((drop) => seen.add(drop.id));
  enqueue(fresh[fresh.length - 1]!);
}, { immediate: true });

onUnmounted(reset);
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="image-drop-overlay" aria-hidden="true">
      <div class="image-drop-scene" :class="{ 'is-impacting': phase === 'impact' }">
        <span v-if="phase === 'impact'" class="impact-flash"></span>
        <span v-if="phase === 'impact'" class="impact-ring"></span>
        <span
          v-for="angle in (phase === 'impact' ? shards : [])" :key="angle"
          class="impact-shard" :style="{ '--shard-angle': `${angle}deg` }"
        ></span>
        <figure class="image-drop-sticker" :class="`is-${phase}`">
          <img :src="active.url" :alt="active.caption ?? '掉落的图片'" @load="onLoad" @error="finish" />
          <figcaption class="image-drop-caption">{{ caption }}</figcaption>
        </figure>
      </div>
    </div>
  </Teleport>
</template>
