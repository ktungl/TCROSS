<script setup lang="ts">
import { confirmState, resolveConfirm } from '../composables/useConfirm'
import { useEscape } from '../composables/useEscape'

useEscape(() => resolveConfirm(false), { active: () => confirmState.visible, isConfirm: true })
</script>

<template>
  <div v-if="confirmState.visible" class="modal" @click.self="resolveConfirm(false)">
    <div class="card confirm-card">
      <p class="flush-m">{{ confirmState.message }}</p>
      <div class="row actions">
        <button class="btn" :class="{ danger: confirmState.danger }" @click="resolveConfirm(true)">{{ confirmState.confirmLabel }}</button>
        <button class="btn ghost" @click="resolveConfirm(false)">取消</button>
      </div>
    </div>
  </div>
</template>
