<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患整改管理</h2>
        <p class="page-desc">
          巡检上报的问题数按项同步到本台账并挂「待整改」；处理意见在此回写后，与整改派工清单两边同一份。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出隐患整改台账</button>
      </div>
    </header>

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
      <span class="legend-item">其中巡检上报同步：{{ syncedCount }} 条</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>隐患部位</span>
        <input v-model="filters['隐患部位']" placeholder="按隐患部位检索" />
      </label>
      <label class="filter-item">
        <span>来源巡检编号</span>
        <input v-model="filters['来源巡检编号']" placeholder="按巡检编号检索" />
      </label>
      <label class="filter-item check">
        <input v-model="onlySynced" type="checkbox" />
        <span>只看巡检上报同步</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>隐患编号</th>
          <th>隐患部位</th>
          <th>隐患等级</th>
          <th>整改措施</th>
          <th>来源巡检编号</th>
          <th>发现日期</th>
          <th>整改期限</th>
          <th>派工编号</th>
          <th>处理意见（回写派工清单）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shownRows" :key="String(row.id)">
          <td>{{ row['隐患编号'] }}</td>
          <td>{{ row['隐患部位'] }}</td>
          <td>
            {{ row['隐患等级'] }}
            <span v-if="row['隐患等级'] === '重大'" class="mini-badge danger">重大</span>
          </td>
          <td>{{ row['整改措施'] }}</td>
          <td>
            <span v-if="row['来源巡检编号']">
              <RouterLink class="link" :to="`/patrol`">{{ row['来源巡检编号'] }}</RouterLink>
            </span>
            <span v-else class="muted-text">手工台账</span>
          </td>
          <td>{{ row['发现日期'] }}</td>
          <td>{{ row['整改期限'] }}</td>
          <td>
            <RouterLink class="link" to="/dispatch">{{ row['派工编号'] || '待生成' }}</RouterLink>
          </td>
          <td class="opinion-cell">
            <input
              :value="String(row['处理意见'] ?? '')"
              class="opinion-input"
              placeholder="填写处理意见"
              @change="onOpinion(row, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="act('派发整改', row)">派发整改</button>
            <button class="link" type="button" @click="act('提交验收', row)">提交验收</button>
            <button class="link" type="button" @click="act('标记逾期', row)">标记逾期</button>
          </td>
        </tr>
        <tr v-if="!shownRows.length">
          <td :colspan="11" class="empty-state">暂无符合条件的隐患记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ shownRows.length }} 条隐患记录，与派工清单逐条同源联动</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runHazardAction,
  saveDispatchOpinion,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hazard')
const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({ 隐患部位: '', 来源巡检编号: '' })
const onlySynced = ref(false)
const message = ref('')
const messageOk = ref(false)

const statuses = ['待整改', '整改中', '已验收', '已逾期']

const shownRows = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, v]) => v.trim() !== '')
  return rows.value.filter((row) => {
    if (onlySynced.value && !row['来源巡检编号']) return false
    return pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim()))
  })
})

const syncedCount = computed(() => rows.value.filter((row) => Boolean(row['来源巡检编号'])).length)

const liveStats = computed(() => [
  { label: '待整改隐患', value: rows.value.filter((r) => r.status === '待整改').length },
  { label: '整改中隐患', value: rows.value.filter((r) => r.status === '整改中').length },
  { label: '已逾期隐患', value: rows.value.filter((r) => r.status === '已逾期').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => String(row.status) === status).length })),
)

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  message.value = ''
  try {
    rows.value = listEntries(meta.key, {}).items
  } catch (error) {
    notify(false, error instanceof Error ? error.message : '隐患台账读取失败')
  }
}

function resetFilters() {
  filters.value = { 隐患部位: '', 来源巡检编号: '' }
  onlySynced.value = false
}

function act(action: string, row: EntryRow) {
  const result = runHazardAction(String(row['隐患编号']), action)
  notify(result.ok, result.message)
  reload()
}

function onOpinion(row: EntryRow, opinion: string) {
  const result = saveDispatchOpinion(String(row['隐患编号']), opinion.trim())
  notify(result.ok, result.message)
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

onMounted(reload)
</script>
