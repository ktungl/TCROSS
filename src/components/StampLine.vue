<script setup lang="ts">
import { actorLine } from '../utils/actor'
import type { ActorStamp } from '../types'

defineProps<{ record: ActorStamp }>()
</script>

<template>
  <span class="actor-stamp">
    建立：{{ actorLine(record.createdByName, record.createdAt) }}　｜　最後修改：{{
      actorLine(record.updatedByName, record.updatedAt)
    }}
  </span>
</template>
