<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

withDefaults(defineProps<{ title: string; wide?: boolean; dismissible?: boolean }>(), { dismissible: true });
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
let previousOverflow = '';
onMounted(() => {
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  dialog.value?.showModal();
});
onUnmounted(() => { document.body.style.overflow = previousOverflow; });
</script>

<template>
  <dialog ref="dialog" :class="['app-dialog', { 'dialog-wide': wide }]" aria-labelledby="dialog-title" @close="emit('close')" @cancel="!dismissible && $event.preventDefault()" @click="dismissible && ($event.target === $event.currentTarget) && emit('close')">
    <div class="dialog-content">
      <div class="dialog-top"><h2 id="dialog-title">{{ title }}</h2><button class="icon-button" aria-label="关闭弹窗" :disabled="!dismissible" @click="emit('close')"><AppIcon name="close" /></button></div>
      <slot />
    </div>
  </dialog>
</template>
