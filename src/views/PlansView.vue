<script setup lang="ts">
import { ref } from 'vue'
import PlanManager from '../components/PlanManager.vue'
import CategoryManager from '../components/CategoryManager.vue'

// 手機版沒有並排的寬度，改用分頁切換；電腦版靠 CSS 直接兩欄並排顯示，
// 這個狀態只在手機版生效（見 main.css 的 .pane-tabs／.pane 規則）。
const activeTab = ref<'plans' | 'categories'>('plans')
</script>

<template>
  <h1>計畫與分類管理</h1>
  <p class="sub">管理計畫與活動分類；一個活動可以同時掛在多個計畫底下。</p>

  <div class="pane-tabs">
    <button :class="{ active: activeTab === 'plans' }" @click="activeTab = 'plans'">計畫</button>
    <button :class="{ active: activeTab === 'categories' }" @click="activeTab = 'categories'">分類管理</button>
  </div>

  <div class="dual-pane">
    <div class="pane" :class="{ active: activeTab === 'plans' }">
      <h2>計畫</h2>
      <PlanManager />
    </div>
    <div class="pane" :class="{ active: activeTab === 'categories' }">
      <h2>分類管理</h2>
      <CategoryManager />
    </div>
  </div>
</template>
