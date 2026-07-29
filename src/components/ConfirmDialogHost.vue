<script setup lang="ts">
import { confirmState, resolveConfirm } from '../composables/useConfirm'
</script>

<template>
  <div v-if="confirmState.visible" class="modal" @click.self="resolveConfirm(false)">
    <div class="card" style="max-width:400px">
      <p style="margin-top:0">{{ confirmState.message }}</p>
      <div class="row" style="margin-top:20px">
        <button class="btn" @click="resolveConfirm(true)">確定</button>
        <button class="btn ghost" @click="resolveConfirm(false)">取消</button>
      </div>
    </div>
  </div>
</template>
