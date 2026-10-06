<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，并呈现巡检排班的同日分布与关键条目（与各看板同源、一起变）。</p>
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

    <div class="overview-grid">
      <section class="panel">
        <h3 class="panel-title">巡检任务同日分布（近 14 天）</h3>
        <div class="dist-chart">
          <div v-for="b in patrol.distribution" :key="b.date" class="dist-col" :title="`${b.date}：${b.total} 条 / ${b.teams} 个班组`">
            <div class="dist-bar-track">
              <div class="dist-bar" :class="{ overloaded: b.total >= 3 }" :style="{ height: barHeight(b.total) + 'px' }">
                <span class="dist-num">{{ b.total }}</span>
              </div>
            </div>
            <span class="dist-day">{{ b.date.slice(5) }}</span>
          </div>
        </div>
        <p class="panel-foot">
          柱高为当天巡检任务数，≥3 条标红；班组数见悬浮提示。
          <RouterLink class="link" to="/patrol">去排班视图 →</RouterLink>
        </p>
      </section>

      <section class="panel">
        <h3 class="panel-title">
          关键条目（{{ patrol.focus.length }}）
          <RouterLink class="link panel-more" to="/focus">全部</RouterLink>
        </h3>
        <ul class="focus-list">
          <li v-for="(item, i) in patrol.focus.slice(0, 6)" :key="i" class="focus-li">
            <span class="mini-badge" :class="item.level === '高' ? 'danger' : 'warn'">{{ item.kind }}</span>
            <span class="focus-title">{{ item.title }}</span>
          </li>
          <li v-if="!patrol.focus.length" class="muted-text">暂无关键条目</li>
        </ul>
      </section>
    </div>

    <div class="consistency-bar" :class="patrol.consistent ? 'is-ok' : 'is-bad'">
      <span>
        条数核对：排班看板本周 <strong>{{ patrol.weekCount }}</strong> 条 ·
        巡检明细（去重后）<strong>{{ patrol.detailCount }}</strong> 条 ·
        待整改隐患 <strong>{{ patrol.pendingHazards }}</strong> 条
      </span>
      <span>{{ patrol.consistent ? '✓ 概览与看板同源，条数一致，两处一起变' : '× 概览与看板条数不一致，请重新统计' }}</span>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const patrol = ref<OverviewResult['patrol']>({
  detailCount: 0,
  weekCount: 0,
  pendingHazards: 0,
  consistent: true,
  distribution: [],
  focus: [],
})

const maxBar = 4

function barHeight(total: number): number {
  return Math.min(120, 16 + (total / maxBar) * 104)
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  patrol.value = payload.patrol
}

onMounted(refresh)
</script>
