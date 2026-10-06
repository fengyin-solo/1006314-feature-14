<template>
  <section class="page" data-module="schedule">
    <header class="page-head">
      <div>
        <h2>廊内巡检排班视图</h2>
        <p class="page-desc">横着一周、竖着班组：格子里是当天的巡检路线与计划日期，点格子回到巡检任务明细（同一路线同一天已按巡检编号去重）。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="shiftWeek(-1)">上一周</button>
        <button class="btn primary" type="button" @click="goCurrentWeek">本周</button>
        <button class="btn" type="button" @click="shiftWeek(1)">下一周</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">本周排班任务（去重后）</span>
        <strong class="stat-value">{{ board.weekTaskCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">班组一天多线（重负）</span>
        <strong class="stat-value warn">{{ board.overloads.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">路线连续三天及以上空班</span>
        <strong class="stat-value warn">{{ board.gaps.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">排班账明细总条数</span>
        <strong class="stat-value">{{ counts.patrolKept }}</strong>
      </article>
    </div>

    <div class="alert-strip" v-if="board.overloads.length || board.gaps.length">
      <p v-for="item in board.overloads" :key="`o-${item.team}-${item.date}`" class="alert-line warn">
        重负：{{ item.team }} 在 {{ item.date }} 一天被排到 {{ item.count }} 条路线（{{ item.routes.join('、') }}）。
        <RouterLink :to="patrolLink({ 巡检班组: item.team, 计划日期: item.date })">查看明细</RouterLink>
      </p>
      <p v-for="item in board.gaps" :key="`g-${item.route}`" class="alert-line gap">
        空班：{{ item.route }} 在 {{ item.missingDays[0] }} ~ {{ item.missingDays[item.missingDays.length - 1] }} 连续 {{ item.maxGap }} 天无人去。
        <RouterLink :to="patrolLink({ 巡检路线: item.route })">查看该路线明细</RouterLink>
      </p>
    </div>

    <div class="board-wrap">
      <table class="schedule-grid">
        <thead>
          <tr>
            <th class="team-col">巡检班组 ＼ 日期</th>
            <th v-for="day in board.days" :key="day.date" :class="{ today: day.isToday }">
              <span class="weekday">{{ day.weekday }}</span>
              <span class="day-date">{{ day.date.slice(5) }}</span>
              <span v-if="day.isToday" class="today-tag">今天</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="team in board.teams" :key="team">
            <td class="team-col">{{ team }}</td>
            <td
              v-for="day in board.days"
              :key="day.date"
              class="board-cell"
              :class="{ today: day.isToday, overloaded: cell(team, day.date).tasks.length > 1 }"
            >
              <button
                v-for="task in cell(team, day.date).tasks"
                :key="String(task.id)"
                class="cell-task"
                type="button"
                @click="openTask(task)"
              >
                <span class="route-name">{{ shortRoute(task._route) }}</span>
                <span class="plan-date">📅 {{ task._planDate }}</span>
                <span class="task-meta">
                  <span v-if="task._crewInferred" class="tag inferred">推定班组</span>
                  <span v-if="task._dateBackfilled" class="tag backfilled">日期回填</span>
                  <span v-if="task._issues > 0" class="tag issue">{{ task._issues }} 项问题</span>
                  <span class="task-code">{{ task._code }}</span>
                </span>
              </button>
              <span v-if="!cell(team, day.date).tasks.length" class="cell-empty">—</span>
            </td>
          </tr>
          <tr v-if="!board.teams.length">
            <td :colspan="8" class="empty-state">本周没有可排班的巡检任务（缺计划日期的任务只在明细里展示）</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>
        对账：本周排班格子任务数 {{ board.weekTaskCount }}；巡检明细去重后共 {{ counts.patrolKept }} 条，
        其中按编号/同日重复并入 {{ counts.patrolMerged }} 条（保留可查），班组推定 {{ counts.patrolInferred }} 条。
        该数字与运营概览、关键条目页取同一口径。
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'

import { onDataChanged } from '@/api/events'
import { patrolSnapshot, scheduleBoard } from '@/api/governance-service'
import { mondayOf, type ScheduleCell, type ScheduleTask } from '@/data/governance'

const router = useRouter()
const anchor = ref(new Date())
// 数据层不是响应式的，用 tick 让格子在落账事件后重算。
const tick = ref(0)

const board = computed(() => {
  void tick.value
  return scheduleBoard(anchor.value)
})
const counts = computed(() => {
  void tick.value
  const snapshot = patrolSnapshot()
  return {
    patrolKept: snapshot.totalKept,
    patrolMerged: snapshot.totalMerged,
    patrolInferred: snapshot.totalInferred,
  }
})

let unsubscribe: (() => void) | null = null
onMounted(() => {
  unsubscribe = onDataChanged(() => {
    tick.value += 1
  })
})
onUnmounted(() => {
  unsubscribe?.()
})

function shiftWeek(delta: number) {
  const date = mondayOf(anchor.value)
  date.setDate(date.getDate() + delta * 7)
  anchor.value = date
}

function goCurrentWeek() {
  anchor.value = new Date()
}

function cell(team: string, date: string): ScheduleCell {
  return board.value.cells[`${team}|${date}`] ?? { team, date, tasks: [] }
}

function shortRoute(route: string): string {
  return route.replace(/^R\d+-/, '')
}

function patrolLink(filters: Record<string, string>): RouteLocationRaw {
  return { path: '/patrol', query: filters }
}

function openTask(task: ScheduleTask) {
  router.push({ path: '/patrol', query: { 巡检编号: task._code } })
}
</script>
