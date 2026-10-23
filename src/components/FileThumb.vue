<script setup lang="ts">
import { attachmentSrc } from '../lib/attachments'
import { fileExt, isImageFile } from '../utils/file'

/** 檔案方格：圖片顯示縮圖，其他格式顯示副檔名。link 時點了在新分頁開啟原檔。 */
defineProps<{ name: string; url: string; link?: boolean }>()
</script>

<template>
  <component
    :is="link ? 'a' : 'span'"
    class="file-thumb"
    v-bind="link ? { href: attachmentSrc(url, name), target: '_blank', rel: 'noopener', title: name } : {}"
  >
    <img v-if="isImageFile(name)" :src="attachmentSrc(url, name)" :alt="name" loading="lazy" decoding="async">
    <span v-else class="file-icon">.{{ fileExt(name) || '—' }}</span>
  </component>
</template>
