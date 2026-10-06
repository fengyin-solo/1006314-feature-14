<template>
  <section class="page" data-module="dispatch">
    <header class="page-head">
      <div>
        <h2>派工清单</h2>
        <p class="page-desc">
          巡检上报、隐患整改、往期单据核对的处理意见都回写到这里；同一个动作连着触发多回只落一条，
          后续回合并入轨迹。与关键条目页取同一份数据。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/keyitems">打开关键条目台账</RouterLink>
        <button class="btn" type="button" @click="reload">刷新</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">派工单总数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待处理</span>
        <strong class="stat-value">{{ countByStatus('待处理') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">处理中</span>
        <strong class="stat-value">{{ countByStatus('处理中') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已闭环</span>
        <strong class="stat-value">{{ countByStatus('已闭环') }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>检索</span>
        <input v-model="keyword" placeholder="按单号 / 来源编号 / 动作检索" />
      </label>
    </form>

    <table class="data-table dispatch-table">
      <thead>
        <tr>
          <th>派工编号</th>
          <th>来源</th>
          <th>动作</th>
          <th>摘要</th>
          <th>状态</th>
          <th>处理意见（与关键条目页同一份）</th>
          <th>轨迹</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id">
          <td>{{ row.派工编号 }}</td>
          <td>
            <span class="kind-badge" :class="row.来源类型">{{ sourceLabel(row.来源类型) }}</span>
            <RouterLink v-if="row.来源类型 === 'patrol'" :to="{ path: '/patrol', query: { 巡检编号: row.来源编号 } }">{{ row.来源编号 }}</RouterLink>
            <RouterLink v-else-if="row.来源类型 === 'hazard'" :to="{ path: '/hazard', query: { 隐患编号: row.来源编号 } }">{{ row.来源编号 }}</RouterLink>
            <span v-else>{{ row.来源编号 }}</span>
          </td>
          <td>{{ row.动作 }}</td>
          <td>{{ row.摘要 }}</td>
          <td><span class="status-pill" :class="row.状态">{{ row.状态 }}</span></td>
          <td class="opinion-cell">
            <textarea
              :value="row.处理意见"
              rows="2"
              placeholder="填写处理意见，保存后关键条目页同步可见"
              @input="onEdit(row.id, ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <button class="btn small primary" type="button" @click="save(row)">回写保存</button>
            <p v-if="feedback[row.id]" class="opinion-feedback">{{ feedback[row.id] }}</p>
          </td>
          <td class="trail-cell">
            <ul class="trail-list">
              <li v-for="(entry, index) in row.trail" :key="index">
                <span class="trail-time">{{ entry.time }}</span>
                <span class="trail-kind" :class="{ merged: entry.kind === '重复触发合并' }">{{ entry.kind }}</span>
                <span>{{ entry.detail }}</span>
              </li>
            </ul>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td colspan="7" class="empty-state">暂无派工单，去关键条目页处理一条试试</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { onDataChanged } from '@/api/events'
import { listDispatches, saveOpinion } from '@/api/governance-service'
import type { DispatchRow } from '@/data/governance'

const rows = ref<DispatchRow[]>([])
const keyword = ref('')
const drafts = ref<Record<number, string>>({})
const feedback = ref<Record<number, string>>({})

const filteredRows = computed(() => {
  const value = keyword.value.trim()
  if (!value) {
    return rows.value
  }
  return rows.value.filter((row) =>
    [row.派工编号, row.来源编号, row.动作, row.摘要].some((field) => String(field).includes(value)),
  )
})

function countByStatus(status: DispatchRow['状态']): number {
  return rows.value.filter((row) => row.状态 === status).length
}

function sourceLabel(type: DispatchRow['来源类型']): string {
  return { patrol: '巡检', hazard: '隐患', legacy: '往期单据', failure: '失败重试' }[type]
}

function onEdit(id: number, value: string) {
  drafts.value = { ...drafts.value, [id]: value }
}

function save(row: DispatchRow) {
  const opinion = drafts.value[row.id] ?? row.处理意见
  const result = saveOpinion(row.来源类型, row.来源编号, opinion, row.动作)
  feedback.value = { ...feedback.value, [row.id]: result.message }
  reload()
}

function reload() {
  rows.value = listDispatches()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  reload()
  unsubscribe = onDataChanged(reload)
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>
