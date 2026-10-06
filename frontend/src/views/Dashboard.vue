<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；巡检排班、关键条目与各看板取同一份口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="overview-block">
      <div class="block-head">
        <h3>本周巡检同日分布</h3>
        <RouterLink class="link" to="/schedule">打开排班视图 →</RouterLink>
      </div>
      <div class="distribution">
        <RouterLink
          v-for="day in dayDistribution"
          :key="day.date"
          class="dist-col"
          :class="{ today: day.isToday }"
          :to="{ path: '/patrol', query: { 计划日期: day.date } }"
        >
          <span class="dist-count">{{ day.count }}</span>
          <span class="dist-bar" :style="{ height: `${barHeight(day.count)}px` }"></span>
          <span class="dist-weekday">{{ day.weekday }}</span>
          <span class="dist-date">{{ day.date.slice(5) }}</span>
        </RouterLink>
      </div>
      <p class="reconcile">
        对账：排班视图格子任务数与本图、巡检明细条数同口径——明细原始 {{ patrol.raw }} 条，
        去重后保留 <strong>{{ patrol.kept }}</strong> 条（重复并入 {{ patrol.merged }} 条，班组推定 {{ patrol.inferred }} 条）。
      </p>
    </section>

    <section class="overview-block">
      <div class="block-head">
        <h3>关键条目概览（共 {{ keyItems.total }} 条，与关键条目页同一个数）</h3>
        <RouterLink class="link" to="/keyitems">打开关键条目台账 →</RouterLink>
      </div>
      <div class="stat-row compact">
        <article v-for="group in keyItems.groups" :key="group.label" class="stat-card">
          <span class="stat-label">{{ group.label }}</span>
          <strong class="stat-value">{{ group.count }}</strong>
        </article>
      </div>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name" :class="{ unified: row.name === '廊内巡检任务' }">
          <td>{{ row.name }}<span v-if="row.name === '廊内巡检任务'" class="unified-tag">与排班同口径</span></td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里（账套 v2），概览与看板条数来自同一份统计，变化时两处一起变。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { onDataChanged } from '@/api/events'
import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const patrol = ref<OverviewResult['patrol']>({ raw: 0, kept: 0, merged: 0, inferred: 0 })
const keyItems = ref<OverviewResult['keyItems']>({ total: 0, groups: [] })
const dayDistribution = ref<OverviewResult['dayDistribution']>([])

const maxCount = () => Math.max(1, ...dayDistribution.value.map((day) => day.count))
function barHeight(count: number): number {
  return 24 + Math.round((count / maxCount()) * 96)
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  patrol.value = payload.patrol
  keyItems.value = payload.keyItems
  dayDistribution.value = payload.dayDistribution
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  refresh()
  unsubscribe = onDataChanged(refresh)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
