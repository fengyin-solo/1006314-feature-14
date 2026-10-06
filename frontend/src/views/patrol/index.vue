<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>廊内巡检任务管理</h2>
        <p class="page-desc">围绕巡检编号、巡检路线、巡检班组、计划日期做筛选与状态流转。明细条数与排班视图、运营概览同口径（去重后 {{ snapshot.totalKept }} 条）。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/schedule">打开排班视图</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出廊内巡检任务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待巡检任务（去重口径）</span>
        <strong class="stat-value">{{ pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">巡检中任务</span>
        <strong class="stat-value">{{ runningCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">本月发现问题数</span>
        <strong class="stat-value">{{ snapshot.monthIssues }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">重复并入 / 班组推定</span>
        <strong class="stat-value">{{ snapshot.totalMerged }} / {{ snapshot.totalInferred }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <label class="legend-toggle">
        <input v-model="showMerged" type="checkbox" />
        显示已并入记录（{{ snapshot.totalMerged }} 条，不进排班）
      </label>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="activeQueryHint" class="query-hint">
      从排班视图定位：{{ activeQueryHint }}
      <button class="link" type="button" @click="resetFilters">清除定位</button>
    </div>

    <table class="data-table patrol-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ merged: !row._kept }">
          <td>
            {{ row[columnOf('巡检编号')] ?? '—' }}
            <span v-if="!row._kept" class="tag merged-tag" :title="row._dupKind">已并入</span>
          </td>
          <td>{{ row[columnOf('巡检路线')] ?? '—' }}</td>
          <td>
            {{ row._crew || '—' }}
            <span v-if="row._crewInferred" class="tag inferred" title="早年无班组，按路线归属推定">推定</span>
          </td>
          <td>
            {{ row._planDate || '—' }}
            <span v-if="row._dateBackfilled" class="tag backfilled" title="原计划日期缺失，按完成时间回填">回填</span>
          </td>
          <td>{{ row[columnOf('完成时间')] ?? '—' }}</td>
          <td>{{ row._issues }}</td>
          <td>{{ row[columnOf('巡检人员')] ?? '—' }}</td>
          <td>{{ row[columnOf('巡检状态')] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="!row._kept" class="merge-note">（{{ row._dupKind }} → {{ row._mergedInto }}）</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('开始巡检', row)">开始巡检</button>
            <button class="link" type="button" @click="runAction('确认完成', row)">确认完成</button>
            <button class="link" type="button" @click="reportIssue(row)">上报问题</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ showMerged ? '暂无符合条件的巡检任务' : '暂无符合条件的巡检任务（被去重并入的记录可勾选上方复选框查看）' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        明细 {{ visibleScopeText }}：显示 {{ rows.length }} 条 / 全量 {{ snapshot.totalRaw }} 条原始记录，
        去重保留 {{ snapshot.totalKept }} 条（与排班视图一致）。
      </span>
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
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { patrolSnapshot, reportPatrolIssue } from '@/api/governance-service'
import type { GovernedPatrol } from '@/data/governance'

const route = useRoute()
const router = useRouter()

const meta = moduleMeta('patrol')
const columns = ['巡检编号', '巡检路线', '巡检班组', '计划日期', '完成时间', '发现问题数', '巡检人员', '巡检状态']
const filterFields = columns.slice(0, 4)

const rows = ref<GovernedPatrol[]>([])
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const showMerged = ref(false)

const snapshot = ref(patrolSnapshot())

const pendingCount = computed(
  () => snapshot.value.kept.filter((row) => String(row.status) === '待巡检').length,
)
const runningCount = computed(
  () => snapshot.value.kept.filter((row) => String(row.status) === '巡检中').length,
)
const statusSummary = computed(() =>
  ['待巡检', '巡检中', '已完成', '已上报'].map((status) => ({
    status,
    count: snapshot.value.kept.filter((row) => String(row.status) === status).length,
  })),
)

const activeQueryHint = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  if (!pairs.length) {
    return ''
  }
  return pairs.map(([field, value]) => `${field}="${value}"`).join('，')
})

const visibleScopeText = computed(() => (showMerged.value ? '（含已并入记录）' : '（去重后）'))

function columnOf(column: string): string {
  return column
}

function syncFromRoute() {
  const fromQuery: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) {
    if (typeof value === 'string' && value) {
      fromQuery[key] = value
    }
  }
  filters.value = fromQuery
}

function resetFilters() {
  filters.value = {}
  router.replace({ path: '/patrol' })
  reload()
}

watch(() => route.query, syncFromRoute)

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: GovernedPatrol) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reportIssue(row: GovernedPatrol) {
  errorMessage.value = ''
  successMessage.value = ''
  const input = window.prompt(`巡检 ${row._code} 本次上报多少项问题？（同一动作连续多回只并入同一条轨迹）`, '1')
  if (input === null) {
    return
  }
  const added = Number(input)
  if (!Number.isFinite(added) || added <= 0) {
    errorMessage.value = '问题数需为大于 0 的数字，本次未上报'
    return
  }
  const result = reportPatrolIssue(Number(row.id), Math.floor(added))
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    successMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  snapshot.value = patrolSnapshot()
  try {
    const pool = showMerged.value ? snapshot.value.tasks : snapshot.value.kept
    // 明细筛选口径与通用服务一致（包含匹配），只是池子里换成治理后的任务。
    rows.value = filterRows(pool, filters.value) as GovernedPatrol[]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '廊内巡检任务列表读取失败'
  }
}

watch(showMerged, reload)

onMounted(() => {
  syncFromRoute()
  reload()
})
</script>
