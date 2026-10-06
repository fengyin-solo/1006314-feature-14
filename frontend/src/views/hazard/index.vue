<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患整改管理</h2>
        <p class="page-desc">巡检上报的问题数同步挂入本台账并挂“待整改”，按巡检编号幂等不重复建账；既有状态结论不改写。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="syncFromPatrol">同步巡检问题</button>
        <button class="btn" type="button" @click="exportRows">导出隐患整改清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item source-legend">其中巡检上报挂账：{{ sourcedCount }} 条</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="sourceHint" class="query-hint">
      从关键条目定位巡检挂账：来源巡检编号 = {{ sourceHint }}
      <button class="link" type="button" @click="resetFilters">清除定位</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ sourced: String(row['来源巡检编号'] ?? '') !== '' }">
          <td>{{ row['隐患编号'] ?? '—' }}</td>
          <td>{{ row['隐患部位'] ?? '—' }}</td>
          <td>{{ row['隐患等级'] ?? '—' }}</td>
          <td>{{ row['整改措施'] ?? '—' }}</td>
          <td>{{ row['责任人员'] ?? '—' }}</td>
          <td>{{ row['发现日期'] ?? '—' }}</td>
          <td>{{ row['整改期限'] ?? '—' }}</td>
          <td>{{ row['整改状态'] ?? '—' }}</td>
          <td>
            <template v-if="row['来源巡检编号']">
              <RouterLink :to="{ path: '/patrol', query: { 巡检编号: String(row['来源巡检编号']) } }">{{ row['来源巡检编号'] }}</RouterLink>
            </template>
            <span v-else>—</span>
          </td>
          <td>{{ row['上报问题数'] ?? 0 }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无隐患整改数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患记录（巡检上报挂账 {{ sourcedCount }} 条，状态为待整改/整改中）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { syncPatrolHazards } from '@/api/governance-service'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()

const meta = moduleMeta('hazard')
const columns = ['隐患编号', '隐患部位', '隐患等级', '整改措施', '责任人员', '发现日期', '整改期限', '整改状态', '来源巡检编号', '上报问题数']
const actions = ['派发整改', '提交验收', '标记逾期']
const statuses = ['待整改', '整改中', '已验收', '已逾期']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['隐患部位', '隐患等级', '来源巡检编号']

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const sourcedCount = computed(
  () => rows.value.filter((row) => String(row['来源巡检编号'] ?? '') !== '').length,
)
const sourceHint = computed(() => filters.value['来源巡检编号'] ?? '')

const stats = computed(() => [
  { label: '待整改隐患', value: rows.value.filter((row) => String(row.status) === '待整改').length },
  { label: '整改中隐患', value: rows.value.filter((row) => String(row.status) === '整改中').length },
  { label: '已逾期隐患', value: rows.value.filter((row) => String(row.status) === '已逾期').length },
])

function syncFromRoute() {
  const fromQuery: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string' && value) {
      fromQuery[key] = value
    }
  }
  filters.value = fromQuery
}

watch(() => route.query, syncFromRoute)

function resetFilters() {
  filters.value = {}
  router.replace({ path: '/hazard' })
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function syncFromPatrol() {
  errorMessage.value = ''
  const result = syncPatrolHazards()
  successMessage.value =
    result.created === 0 && result.updated === 0
      ? '巡检问题已是最新，无需新增挂账（幂等）'
      : `同步完成：新建挂账 ${result.created} 条，更新问题数 ${result.updated} 条`
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key)
    rows.value = filterRows(payload.items, filters.value)
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患整改台账读取失败'
  }
}

onMounted(() => {
  syncFromRoute()
  reload()
})
</script>
