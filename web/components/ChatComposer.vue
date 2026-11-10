<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from './AppIcon.vue';

const model = defineModel<string>({ required: true });
defineProps<{
  disabled: boolean;
  sending: boolean;
  placeholder: string;
}>();
const emit = defineEmits<{ send: [] }>();
const input = ref<HTMLTextAreaElement>();

function resize() {
  if (!input.value) return;
  input.value.style.height = 'auto';
  input.value.style.height = `${Math.min(input.value.scrollHeight, 128)}px`;
}
function onEnter(event: KeyboardEvent) {
  if (!event.isComposing && !('ontouchstart' in window)) {
    event.preventDefault();
    emit('send');
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="emit('send')">
    <div class="composer-box">
      <textarea
        id="message-draft" name="message" ref="input" v-model="model" rows="1" maxlength="500"
        :aria-label="placeholder" :placeholder="placeholder" :disabled="disabled"
        @input="resize" @keydown.enter.exact="onEnter"
      ></textarea>
      <button class="send-button" type="submit" :disabled="disabled || !model.trim() || sending" aria-label="发送消息">
        <span v-if="sending" class="spinner"></span>
        <AppIcon v-else name="send" :size="21" />
      </button>
    </div>
    <div class="composer-caption"><span>你的消息只在这个房间里可见</span><span>{{ model.length }} / 500</span></div>
  </form>
</template>
