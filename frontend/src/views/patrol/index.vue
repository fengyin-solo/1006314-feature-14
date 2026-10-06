<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>廊内巡检任务管理</h2>
        <p class="page-desc">
          排班视图按班组与日期铺开：横为一周、竖为班组，格内是当天巡检路线与计划日期；点格子回到对应任务明细。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出巡检任务清单</button>
      </div>
    </header>

    <div class="tab-row">
      <button class="tab" :class="{ active: tab === 'board' }" type="button" @click="tab = 'board'">
        排班视图
      </button>
      <button class="tab" :class="{ active: tab === 'detail' }" type="button" @click="switchToDetail">
        任务明细<span class="tab-count">{{ detailRows.length }}</span>
      </button>
    </div>

    <!-- 排班视图 -->
    <div v-if="tab === 'board'">
      <div class="board-toolbar">
        <button class="btn" type="button" @click="shiftWeek(-1)">上一周</button>
        <strong class="board-range">{{ weekRangeText }}</strong>
        <button class="btn" type="button" @click="shiftWeek(1)">下一周</button>
        <button class="btn ghost" type="button" @click="anchor = BUSINESS_TODAY">回到本周</button>
        <label class="filter-item inline">
          <span>周起点</span>
          <input v-model="anchor" type="date" />
        </label>
      </div>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">本周排班任务（格内合计）</span>
          <strong class="stat-value">{{ summary?.weekCount ?? 0 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">明细总条数（去重后）</span>
          <strong class="stat-value">{{ summary?.detailCount ?? 0 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待整改隐患（巡检上报）</span>
          <strong class="stat-value">{{ summary?.pendingHazards ?? 0 }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">账实核对</span>
          <strong class="stat-value" :class="summary?.consistent ? 'ok-text' : 'error-text'">
            {{ summary?.consistent ? '条数一致' : '不一致' }}
          </strong>
        </article>
      </div>

      <table class="board-table">
        <thead>
          <tr>
            <th class="team-col">巡检班组</th>
            <th v-for="(date, i) in matrix?.dates ?? []" :key="date" class="day-col">
              <div>{{ WEEKDAY_LABELS[i] }}</div>
              <div class="day-date">{{ date.slice(5) }}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(team, ti) in matrix?.teams ?? []" :key="team">
            <td class="team-col team-name">{{ team }}</td>
            <td
              v-for="cell in matrix?.cells[ti] ?? []"
              :key="cell.date"
              class="board-cell"
              :class="{ overloaded: cell.tasks.length >= 3, clickable: cell.tasks.length > 0 }"
              @click="openCell(cell)"
            >
              <div v-for="task in cell.tasks" :key="String(task.id)" class="cell-task">
                <span class="route-name">{{ task['巡检路线'] }}</span>
                <span class="route-date">{{ task['计划日期'] }}</span>
                <span v-if="task['是否推定班组']" class="mini-badge infer">推定</span>
                <span v-if="task['数据来源'] === '扫描件'" class="mini-badge scan">扫描件</span>
              </div>
              <span v-if="cell.tasks.length >= 3" class="overload-flag">超载 {{ cell.tasks.length }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <p class="status-legend">
        <span class="legend-item">班组一天 ≥3 条路线：标红超载</span>
        <span class="legend-item">推定：早年无班组，按路线归属推定</span>
        <span class="legend-item">扫描件：纸面件按扫描件编号建账</span>
        <span class="legend-item">点任意有任务的格子 → 回到当天该班组任务明细</span>
      </p>
    </div>

    <!-- 任务明细 -->
    <div v-else>
      <div class="stat-row">
        <article v-for="item in liveStats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>巡检班组</span>
          <input v-model="filters['巡检班组']" placeholder="按巡检班组检索" />
        </label>
        <label class="filter-item">
          <span>巡检路线</span>
          <input v-model="filters['巡检路线']" placeholder="按巡检路线检索" />
        </label>
        <label class="filter-item">
          <span>只看本周(周一起)</span>
          <input v-model="filters['周起点']" type="date" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in detailRows" :key="String(row.id)">
            <td>{{ row['巡检编号'] }}</td>
            <td>{{ row['巡检路线'] }}</td>
            <td>
              {{ row['巡检班组'] }}
              <span v-if="row['是否推定班组']" class="mini-badge infer">推定</span>
            </td>
            <td>{{ row['计划日期'] }}</td>
            <td>{{ row['完成时间'] || '—' }}</td>
            <td>{{ row['发现问题数'] }}</td>
            <td>{{ row['巡检人员'] || '—' }}</td>
            <td>
              {{ row['巡检状态'] || row.status }}
              <span v-if="row['数据来源'] === '扫描件'" class="mini-badge scan">扫描件 {{ row['扫描件编号'] }}</span>
              <span v-else-if="row['数据来源'] === '抄表周期搬入'" class="mini-badge scan">周期 {{ row['抄表周期'] }}</span>
              <span v-else-if="row['数据来源'] === '历史回填'" class="mini-badge">回填</span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="apply('开始巡检', row)">开始巡检</button>
              <button class="link" type="button" @click="apply('确认完成', row)">确认完成</button>
              <button class="link" type="button" @click="openReport(row)">上报问题</button>
            </td>
          </tr>
          <tr v-if="!detailRows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的巡检任务</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>
          明细 {{ detailRows.length }} 条 <template v-if="hasWeekFilter">（本周口径，与排班看板 {{ summary?.weekCount ?? 0 }} 条同源）</template>
          <span v-if="hasWeekFilter && summary && detailRows.length !== summary.weekCount" class="error-text">
            （与看板条数不一致！）
          </span>
        </span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </div>

    <!-- 上报问题弹窗 -->
    <div v-if="reportTarget" class="modal-mask" @click.self="reportTarget = null">
      <div class="modal">
        <h3>上报巡检问题</h3>
        <p class="page-desc">
          {{ reportTarget['巡检编号'] }} · {{ reportTarget['巡检路线'] }} · {{ reportTarget['计划日期'] }}
        </p>
        <label class="filter-item">
          <span>发现问题数</span>
          <input v-model.number="reportCount" type="number" min="0" step="1" />
        </label>
        <p class="page-desc">确认后问题数同步到隐患整改台账，按项挂「待整改」并生成派工单；重复上报只落一条。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="reportTarget = null">取消</button>
          <button class="btn primary" type="button" @click="confirmReport">确认上报</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  canonicalPatrols,
  downloadEntries,
  listEntries,
  moduleMeta,
  patrolSummary,
  reportPatrolProblems,
  runAction as applyAction,
} from '@/api/local-service'
import { BUSINESS_TODAY, WEEKDAY_LABELS, type CanonicalPatrol, type PatrolMatrix } from '@/data/patrol-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ['巡检编号', '巡检路线', '巡检班组', '计划日期', '完成时间', '发现问题数', '巡检人员', '数据来源']

const tab = ref<'board' | 'detail'>('board')
const anchor = ref(BUSINESS_TODAY)
const rows = ref<CanonicalPatrol[]>([])
const matrix = ref<PatrolMatrix | null>(null)
const summary = ref<ReturnType<typeof patrolSummary> | null>(null)
const filters = ref<Record<string, string>>({ 巡检班组: '', 巡检路线: '', 周起点: '' })
const errorMessage = ref('')
const reportTarget = ref<CanonicalPatrol | null>(null)
const reportCount = ref(1)

const detailRows = computed(() => rows.value)
const hasWeekFilter = computed(() => Boolean(filters.value['周起点']))
const statuses = ['待巡检', '巡检中', '已完成', '已上报']

const liveStats = computed(() => {
  const all = canonicalPatrols()
  const monthPrefix = BUSINESS_TODAY.slice(0, 7)
  return [
    { label: '待巡检任务', value: all.filter((r) => r.status === '待巡检').length },
    { label: '巡检中任务', value: all.filter((r) => r.status === '巡检中').length },
    {
      label: `${monthPrefix} 发现问题数`,
      value: all
        .filter((r) => String(r['计划日期']).startsWith(monthPrefix))
        .reduce((sum, r) => sum + Number(r['发现问题数'] ?? 0), 0),
    },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)

const weekRangeText = computed(() => {
  if (!matrix.value) return ''
  const dates = matrix.value.dates
  return `${dates[0]} ~ ${dates[6]}`
})

function refreshBoard() {
  summary.value = patrolSummary(anchor.value)
  matrix.value = summary.value.matrix
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items as CanonicalPatrol[]
    refreshBoard()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检任务列表读取失败'
  }
}

function shiftWeek(delta: number) {
  const d = new Date(anchor.value)
  d.setDate(d.getDate() + delta * 7)
  anchor.value = d.toISOString().slice(0, 10)
  refreshBoard()
}

type BoardCell = { team: string; date: string; tasks: CanonicalPatrol[] }

// 点格子回到对应任务明细：带上班组+周起点过滤，明细条数与该周看板同源。
function openCell(cell: BoardCell) {
  if (!cell.tasks.length) return
  const monday = matrix.value?.dates[0] ?? anchor.value
  filters.value = { 巡检班组: cell.team, 巡检路线: '', 周起点: monday }
  tab.value = 'detail'
  reload()
}

function switchToDetail() {
  filters.value = { 巡检班组: '', 巡检路线: '', 周起点: '' }
  tab.value = 'detail'
  reload()
}

function resetFilters() {
  filters.value = { 巡检班组: '', 巡检路线: '', 周起点: '' }
  reload()
}

function apply(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function openReport(row: CanonicalPatrol) {
  reportTarget.value = row
  reportCount.value = Number(row['发现问题数'] ?? 0) || 1
}

function confirmReport() {
  if (!reportTarget.value) return
  const result = reportPatrolProblems(Number(reportTarget.value.id), reportCount.value)
  errorMessage.value = result.ok ? '' : result.message
  reportTarget.value = null
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

onMounted(() => {
  refreshBoard()
  rows.value = canonicalPatrols()
})
</script>
