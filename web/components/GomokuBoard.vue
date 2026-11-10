<script setup lang="ts">
import { computed } from 'vue';
import type { GomokuView } from '../lib/types.ts';

const SIZE = 15;
const props = defineProps<{
  board: GomokuView['board'];
  lastMove: GomokuView['lastMove'];
  winningCells: [number, number][] | null;
  disabled: boolean;
}>();
const emit = defineEmits<{ place: [row: number, col: number] }>();

const stars = [
  { row: 3, col: 3 }, { row: 3, col: 11 }, { row: 7, col: 7 },
  { row: 11, col: 3 }, { row: 11, col: 11 },
];
const stones = computed(() => {
  const list: { row: number; col: number; color: 'black' | 'white'; key: string }[] = [];
  props.board.forEach((line, row) => line.forEach((cell, col) => {
    if (cell) list.push({ row, col, color: cell, key: `${row}-${col}` });
  }));
  return list;
});
const winning = computed(() => new Set((props.winningCells ?? []).map(([row, col]) => `${row}-${col}`)));
const lastKey = computed(() => props.lastMove ? `${props.lastMove.row}-${props.lastMove.col}` : '');
function canPlace(row: number, col: number) {
  return !props.disabled && props.board[row]?.[col] === null;
}
</script>

<template>
  <div class="gomoku-board" aria-label="五子棋棋盘">
    <svg class="gomoku-grid" viewBox="-0.5 -0.5 15 15" aria-hidden="true">
      <line v-for="index in SIZE" :key="`h-${index}`" x1="0" :y1="index - 1" x2="14" :y2="index - 1" />
      <line v-for="index in SIZE" :key="`v-${index}`" :x1="index - 1" y1="0" :x2="index - 1" y2="14" />
      <circle v-for="star in stars" :key="`${star.row}-${star.col}`" :cx="star.col" :cy="star.row" r="0.09" class="star" />
      <circle
        v-for="stone in stones" :key="stone.key"
        :cx="stone.col" :cy="stone.row" r="0.42"
        :class="['stone', `stone-${stone.color}`, { winning: winning.has(stone.key) }]"
      />
      <circle v-if="lastMove" :cx="lastMove.col" :cy="lastMove.row" r="0.12" class="last-move" :class="`last-${lastMove.color}`" />
    </svg>
    <div class="gomoku-hits">
      <button
        v-for="index in SIZE * SIZE" :key="index" type="button" class="gomoku-hit"
        :disabled="!canPlace(Math.floor((index - 1) / SIZE), (index - 1) % SIZE)"
        :aria-label="`第 ${Math.floor((index - 1) / SIZE) + 1} 行第 ${(index - 1) % SIZE + 1} 列`"
        @click="emit('place', Math.floor((index - 1) / SIZE), (index - 1) % SIZE)"
      ></button>
    </div>
  </div>
</template>
