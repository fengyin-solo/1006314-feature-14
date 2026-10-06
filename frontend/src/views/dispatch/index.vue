<template>
  <section class="page" data-module="dispatch">
    <header class="page-head">
      <div>
        <h2>整改派工清单</h2>
        <p class="page-desc">
          隐患处理意见回写到这里，隐患台账与本清单取同一份；同一动作重复触发只落一条派工单，后续并入轨迹。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出派工清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in liveStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>派工/隐患/巡检编号</span>
        <input v-model="keyword" placeholder="按编号或部位检索" />
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>派工编号</th>
          <th>隐患编号</th>
          <th>来源巡检编号</th>
          <th>隐患部位</th>
          <th>整改班组</th>
          <th>派工日期</th>
          <th>整改期限</th>
          <th>处理意见（与隐患台账同源）</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in shownRows" :key="String(row.id)">
          <td>{{ row['派工编号'] }}</td>
          <td>
            <RouterLink class="link" to="/hazard">{{ row['隐患编号'] }}</RouterLink>
          </td>
          <td>
            <span v-if="row['来源巡检编号']">
              <RouterLink class="link" to="/patrol">{{ row['来源巡检编号'] }}</RouterLink>
            </span>
            <span v-else class="muted-text">手工台账</span>
          </td>
          <td>{{ row['隐患部位'] }}</td>
          <td>{{ row['整改班组'] }}</td>
          <td>{{ row['派工日期'] }}</td>
          <td>{{ row['整改期限'] }}</td>
          <td class="opinion-cell">
            <input
              :value="String(row['处理意见'] ?? '')"
              class="opinion-input"
              placeholder="回写处理意见"
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
          <td :colspan="10" class="empty-state">暂无派工单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ shownRows.length }} 张派工单，与隐患整改台账逐条同源联动</span>
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
  runDispatchAction,
  saveDispatchOpinion,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dispatch')
const rows = ref<EntryRow[]>([])
const keyword = ref('')
const message = ref('')
const messageOk = ref(false)

const shownRows = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return rows.value
  return rows.value.filter((row) =>
    ['派工编号', '隐患编号', '来源巡检编号', '隐患部位'].some((field) =>
      String(row[field] ?? '').includes(kw),
    ),
  )
})

const liveStats = computed(() => [
  { label: '待派工单', value: rows.value.filter((r) => r.status === '待派工').length },
  { label: '整改中派工单', value: rows.value.filter((r) => r.status === '整改中').length },
  { label: '已逾期派工单', value: rows.value.filter((r) => r.status === '已逾期').length },
])

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  message.value = ''
  try {
    rows.value = listEntries(meta.key, {}).items
  } catch (error) {
    notify(false, error instanceof Error ? error.message : '派工清单读取失败')
  }
}

function act(action: string, row: EntryRow) {
  const result = runDispatchAction(String(row['派工编号']), action)
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
