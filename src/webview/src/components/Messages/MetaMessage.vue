<template>
  <!--
    The official meta row (`m85`), element for element:

      function m85({message:$}){
        let J=$.content[0]?.content, Z=J&&"text"in J?J.text:"";
        if(!Z)return null;
        return F("div",{className:`${u0.metaMessage} ${u0.metaMessageLines}`,children:Z})}

    One div, both classes, the first block's text and nothing else. Empty text
    renders no row at all.
  -->
  <div v-if="text" class="fg-chat__metaMessage fg-chat__metaMessageLines">{{ text }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '../../models/Message';

interface Props {
  message: Message;
}

const props = defineProps<Props>();

/** `$.content[0]?.content`, then `"text" in J ? J.text : ""`. */
const text = computed(() => {
  const content = props.message.message.content;
  if (typeof content === 'string') return content;
  const block = content[0]?.content;
  return block && 'text' in block ? (block as { text: string }).text : '';
});
</script>
