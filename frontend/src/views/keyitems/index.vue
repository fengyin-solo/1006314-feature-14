<template>
  <section class="page" data-module="keyitems">
    <header class="page-head">
      <div>
        <h2>关键条目台账</h2>
        <p class="page-desc">把去重并单、班组推定、巡检挂账隐患、往期单据搬入、超时断线重试等关键条目集中罗列；处理意见回写到同一份派工清单。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/dispatch">打开派工清单（{{ dispatches.length }} 单）</RouterLink>
        <button class="btn" type="button" @click="reload">重新统计</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">关键条目总数（与概览一致）</span>
        <strong class="stat-value">{{ bundle.total }}</strong>
      </article>
      <article v-for="group in bundle.groups" :key="group.kind" class="stat-card clickable" @click="toggleKind(group.kind)">
        <span class="stat-label">{{ group.label }}</span>
        <strong class="stat-value" :class="{ activeKind: activeKinds.has(group.kind) }">{{ group.count }}</strong>
      </article>
    </div>

    <div class="sim-bar">
      <span class="sim-label">传输链路演示：</span>
      <button
        v-for="mode in transportModes"
        :key="mode.value"
        class="btn"
        :class="{ primary: transportMode === mode.value }"
        type="button"
        @click="changeMode(mode.value)"
      >
        {{ mode.label }}
      </button>
      <span class="sim-hint">{{ modeHint }}</span>
    </div>

    <div class="kind-bar">
      <button class="btn ghost" :class="{ primary: activeKinds.size === 0 }" type="button" @click="activeKinds = new Set()">全部条目</button>
      <button
        v-for="group in bundle.groups"
        :key="group.kind"
        class="btn ghost"
        :class="{ primary: activeKinds.has(group.kind) }"
        type="button"
        @click="toggleKind(group.kind)"
      >
        {{ group.label }}（{{ group.count }}）
      </button>
    </div>

    <table class="data-table key-table">
      <thead>
        <tr>
          <th>类别</th>
          <th>编号</th>
          <th>条目</th>
          <th>说明</th>
          <th>日期</th>
          <th>处理意见（回写派工清单）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredItems" :key="`${item.kind}-${item.code}`" :class="['kind-row', item.kind]">
          <td><span class="kind-badge" :class="item.kind">{{ item.kindLabel }}</span></td>
          <td>
            <RouterLink v-if="item.sourceType === 'patrol'" :to="{ path: '/patrol', query: { 巡检编号: item.sourceCode } }">{{ item.code }}</RouterLink>
            <RouterLink v-else-if="item.sourceType === 'hazard'" :to="{ path: '/hazard', query: { 隐患编号: item.sourceCode } }">{{ item.code }}</RouterLink>
            <span v-else>{{ item.code }}</span>
          </td>
          <td>{{ item.title }}</td>
          <td>{{ item.detail }}</td>
          <td>{{ item.date || '—' }}</td>
          <td class="opinion-cell">
            <template v-if="item.kind === 'failure' && item.code.endsWith('已解决') === false">
              <p class="failure-reason">{{ item.detail }}</p>
              <button class="btn primary small" type="button" @click="retryFailure(item.sourceCode)">原处重试一次</button>
            </template>
            <template v-else>
              <textarea
                :value="opinions[opinionKey(item)] ?? ''"
                rows="2"
                placeholder="填写处理意见后回写派工清单，两边同一份"
                @input="onOpinionInput(item, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
              <button class="btn small" type="button" @click="saveOpinion(item)">回写派工</button>
            </template>
            <p v-if="feedback[opinionKey(item)]" class="opinion-feedback">{{ feedback[opinionKey(item)] }}</p>
          </td>
        </tr>
        <tr v-if="!filteredItems.length">
          <td colspan="6" class="empty-state">当前筛选下没有关键条目</td>
        </tr>
      </tbody>
    </table>

    <section class="notes-section">
      <h3>老数据兼容与既有结论处理交代</h3>
      <ul class="notes-list">
        <li v-for="(note, index) in notes" :key="index">
          <strong>{{ note.title }}：</strong>{{ note.body }}
        </li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { onDataChanged } from '@/api/events'
import {
  getTransportMode,
  keyItemBundle as loadKeyItems,
  listDispatches,
  retryFailure as retryFailureRequest,
  saveOpinion as saveOpinionRequest,
  setTransportMode,
} from '@/api/governance-service'
import { GOVERNANCE_NOTES, type KeyItem, type KeyItemKind } from '@/data/governance'
import type { DispatchRow } from '@/data/governance'

const bundle = ref(loadKeyItems())
const dispatches = ref<DispatchRow[]>([])
const activeKinds = ref<Set<KeyItemKind>>(new Set())
const opinions = ref<Record<string, string>>({})
const feedback = ref<Record<string, string>>({})
const transportMode = ref(getTransportMode())
const notes = GOVERNANCE_NOTES

const transportModes: { value: 'online' | 'timeout' | 'offline'; label: string }[] = [
  { value: 'online', label: '链路正常' },
  { value: 'timeout', label: '模拟超时' },
  { value: 'offline', label: '模拟断线' },
]

const modeHint = computed(() => {
  if (transportMode.value === 'online') {
    return '上报与回写直接落账。'
  }
  if (transportMode.value === 'timeout') {
    return '上报会先超时，自动重试一次仍失败，原因记入本表，可切回正常后原处重试。'
  }
  return '上报判定断线，自动重试一次仍失败，不落半截账，恢复后原处重试。'
})

const filteredItems = computed(() => {
  if (activeKinds.value.size === 0) {
    return bundle.value.items
  }
  return bundle.value.items.filter((item) => activeKinds.value.has(item.kind))
})

function opinionKey(item: KeyItem): string {
  return `${item.sourceType}|${item.sourceCode}`
}

function toggleKind(kind: KeyItemKind) {
  const next = new Set(activeKinds.value)
  if (next.has(kind)) {
    next.delete(kind)
  } else {
    next.add(kind)
  }
  activeKinds.value = next
}

function changeMode(mode: 'online' | 'timeout' | 'offline') {
  setTransportMode(mode)
  transportMode.value = mode
}

function onOpinionInput(item: KeyItem, value: string) {
  opinions.value = { ...opinions.value, [opinionKey(item)]: value }
}

function saveOpinion(item: KeyItem) {
  const opinion = opinions.value[opinionKey(item)] ?? ''
  const result = saveOpinionRequest(item.sourceType, item.sourceCode, opinion)
  feedback.value = { ...feedback.value, [opinionKey(item)]: result.message }
  reload()
}

function retryFailure(sourceCode: string) {
  const result = retryFailureRequest(Number(sourceCode))
  const key = `failure|${sourceCode}`
  feedback.value = { ...feedback.value, [key]: result.message }
  reload()
}

function hydrateOpinions() {
  const map: Record<string, string> = {}
  for (const dispatch of dispatches.value) {
    map[`${dispatch.来源类型}|${dispatch.来源编号}`] = dispatch.处理意见
  }
  opinions.value = map
}

function reload() {
  bundle.value = loadKeyItems()
  dispatches.value = listDispatches()
  hydrateOpinions()
}

let unsubscribe: (() => void) | null = null
onMounted(() => {
  reload()
  unsubscribe = onDataChanged(reload)
})

onUnmounted(() => {
  window.removeEventListener('focus', reload)
  unsubscribe?.()
})
</script>
