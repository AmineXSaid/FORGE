<template>
  <div class="llm-error-block">
    <span class="codicon codicon-error"></span>
    <span class="llm-error-message">{{ block.message }}</span>
  </div>
</template>

<script setup lang="ts">
import type { LLMErrorBlock as LLMErrorBlockType } from '../../../models/ContentBlock';

interface Props {
  block: LLMErrorBlockType;
}

defineProps<Props>();
</script>

<style scoped>
/* 对齐 InterruptBlock 居中提示条风格，使用错误色调 */
.llm-error-block {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background-color: transparent;
}

.llm-error-block .codicon {
  color: var(--vscode-testing-iconFailed);
  flex-shrink: 0;
}

.llm-error-message {
  color: color-mix(in srgb, var(--app-error-foreground) 85%, transparent);
  font-style: italic;
}
</style>
