<template>
  <section class="page" data-module="focus">
    <header class="page-head">
      <div>
        <h2>巡检关键条目</h2>
        <p class="page-desc">
          把排班冲突与挂账风险的关键条目罗列出来：班组超载、路线空窗、重复排班去重、待整改隐患。概览里也呈现同一版。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">重新汇总</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in kindCounts" :key="item.kind" class="stat-card">
        <span class="stat-label">{{ item.kind }}</span>
        <strong class="stat-value">{{ item.count }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 110px">类别</th>
          <th style="width: 70px">级别</th>
          <th>关键条目</th>
          <th>说明</th>
          <th>关联单据</th>
          <th style="width: 110px">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in focus" :key="i">
          <td><span class="mini-badge" :class="kindClass(item.kind)">{{ item.kind }}</span></td>
          <td>
            <span :class="item.level === '高' ? 'error-text' : 'muted-text'">{{ item.level }}</span>
          </td>
          <td>{{ item.title }}</td>
          <td class="muted-text">{{ item.detail }}</td>
          <td>{{ item.refId }}</td>
          <td>
            <RouterLink class="link" :to="item.module === 'patrol' ? '/patrol' : '/hazard'">
              {{ item.module === 'patrol' ? '去巡检' : '去隐患' }}
            </RouterLink>
          </td>
        </tr>
        <tr v-if="!focus.length">
          <td colspan="6" class="empty-state">暂无关键条目，排班与台账均平稳</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>本页与运营概览的「关键条目」「同日分布」取自同一份汇总，条数一致、一起变化</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { patrolSummary } from '@/api/local-service'
import { BUSINESS_TODAY, type FocusItem } from '@/data/patrol-domain'

const focus = ref<FocusItem[]>([])

const kinds: FocusItem['kind'][] = ['班组超载', '路线空窗', '重复排班', '待整改隐患']
const kindCounts = computed(() =>
  kinds.map((kind) => ({ kind, count: focus.value.filter((item) => item.kind === kind).length })),
)

function kindClass(kind: FocusItem['kind']): string {
  if (kind === '班组超载' || kind === '待整改隐患') return 'danger'
  if (kind === '路线空窗') return 'warn'
  return ''
}

function reload() {
  focus.value = patrolSummary(BUSINESS_TODAY).focus
}

onMounted(reload)
</script>
