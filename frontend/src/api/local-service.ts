import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  rawPatrolRows,
  resetRows,
  saveLedgers,
  saveRows,
} from '@/data/local-store'
import { reconcileLedgers, saveOpinion, syncStatusByHazard } from '@/data/ledger-domain'
import {
  appendTrail,
  buildDayDistribution,
  buildFocusItems,
  buildPatrolMatrix,
  BUSINESS_TODAY,
  canonicalizePatrols,
  toCount,
  weekDates,
  type CanonicalPatrol,
  type DayBucket,
  type FocusItem,
  type PatrolMatrix,
} from '@/data/patrol-domain'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  if (key === 'patrol') {
    const matched = filterPatrols(canonicalPatrols(), filters)
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// ---- 巡检排班域：明细/排班/概览都从同一份规范化结果取数，条数不允许出现两个数 ----

export function canonicalPatrols(): CanonicalPatrol[] {
  return canonicalizePatrols(rawPatrolRows()).canonical
}

function filterPatrols(rows: CanonicalPatrol[], filters: Record<string, string>): CanonicalPatrol[] {
  const exact: Array<[string, string]> = [
    ['巡检班组', filters['巡检班组'] ?? ''],
    ['巡检路线', filters['巡检路线'] ?? ''],
    ['周起点', filters['周起点'] ?? ''],
  ]
  return rows.filter((row) =>
    exact.every(([field, value]) => {
      if (!value) return true
      if (field === '周起点') {
        return new Set(weekDates(value)).has(String(row['计划日期']))
      }
      return String(row[field] ?? '').includes(value.trim())
    }),
  )
}

export function patrolBoard(anchor: string): PatrolMatrix {
  return buildPatrolMatrix(canonicalPatrols(), anchor)
}

export function patrolDayDistribution(): DayBucket[] {
  return buildDayDistribution(canonicalPatrols())
}

export type PatrolSummary = {
  detailCount: number
  weekCount: number
  weekAnchor: string
  distribution: DayBucket[]
  matrix: PatrolMatrix
  focus: FocusItem[]
  pendingHazards: number
  consistent: boolean
}

// 概览与看板的唯一数据源：两个页面拿到的同一周条数必然相同。
export function patrolSummary(weekAnchor: string = BUSINESS_TODAY): PatrolSummary {
  const canonical = canonicalPatrols()
  const matrix = buildPatrolMatrix(canonical, weekAnchor)
  const distribution = buildDayDistribution(canonical)
  const pendingHazards = listRows('hazard').filter((row) => String(row.status) !== '已验收')
  const focus = buildFocusItems(canonical, distribution, pendingHazards)
  const detailCount = canonical.length
  const weekCount = matrix.total
  return {
    detailCount,
    weekCount,
    weekAnchor,
    distribution,
    matrix,
    focus,
    pendingHazards: pendingHazards.length,
    // 周内明细（按周起点过滤）条数必须等于看板格子里的任务数。
    consistent: filterPatrols(canonical, { 周起点: weekAnchor }).length === weekCount,
  }
}

// 上报问题：写入发现问题数并转「已上报」。同一巡检重复上报做幂等合并——
// 账上只落一次状态流转，后续触发并入同一条的操作轨迹，问题数以首次上报为准（避免重复累计）。
export function reportPatrolProblems(id: number, countInput: number): ActionResult {
  const rows = rawPatrolRows().map((row) => ({ ...row }))
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的巡检任务` }
  }
  const count = Math.max(0, Math.trunc(Number.isFinite(countInput) ? countInput : 0))
  const current = rows[index]
  if (String(current.status) === '已上报') {
    current['操作轨迹'] = appendTrail(
      String(current['操作轨迹'] ?? ''),
      `重复触发「上报问题」，按幂等并入本条，不再重复落账`,
    )
    try {
      saveRows('patrol', rows)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '上报失败' }
    }
    return { ok: true, message: '该巡检已上报过，本次操作已并入轨迹，台账不重复记账' }
  }
  current.status = '已上报'
  current['巡检状态'] = '已上报'
  current['发现问题数'] = count
  current.pending = false
  current['完成时间'] = current['完成时间'] || new Date().toISOString().slice(0, 16).replace('T', ' ')
  current['操作轨迹'] = appendTrail(
    String(current['操作轨迹'] ?? ''),
    `上报问题 ${count} 项，状态流转为已上报`,
  )
  try {
    saveRows('patrol', rows)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '上报失败' }
  }
  return { ok: true, message: count > 0 ? `已上报 ${count} 项问题，已同步隐患台账并挂待整改` : '已上报，未发现问题' }
}

// 保存处理意见：隐患台账与派工清单两边取同一份。
export function saveDispatchOpinion(hazardNo: string, opinion: string): ActionResult {
  try {
    const { hazards, dispatches } = saveOpinion(listRows('hazard'), listRows('dispatch'), hazardNo, opinion)
    saveLedgers(hazards, dispatches)
    return { ok: true, message: '处理意见已回写，派工清单与隐患台账已同步' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '处理意见回写失败' }
  }
}

// 隐患/派工状态联动动作：一处改、两处变。
export function runHazardAction(hazardNo: string, action: string): ActionResult {
  const meta = moduleMeta('hazard')
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `隐患记录没有登记「${action}」这个动作` }
  }
  const hazards = listRows('hazard')
  if (!hazards.some((row) => String(row['隐患编号']) === hazardNo)) {
    return { ok: false, message: `没有找到隐患编号 ${hazardNo}` }
  }
  try {
    const next = syncStatusByHazard(hazards, listRows('dispatch'), hazardNo, target)
    saveLedgers(next.hazards, next.dispatches)
    return { ok: true, message: `隐患与派工已联动为「${target}」` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '状态流转失败' }
  }
}

export function runDispatchAction(dispatchNo: string, action: string): ActionResult {
  const meta = moduleMeta('dispatch')
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `派工单没有登记「${action}」这个动作` }
  }
  const dispatches = listRows('dispatch')
  const disp = dispatches.find((row) => String(row['派工编号']) === dispatchNo)
  if (!disp) {
    return { ok: false, message: `没有找到派工编号 ${dispatchNo}` }
  }
  return runHazardAction(String(disp['隐患编号']), action)
}

export { reconcileLedgers, toCount }

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key).map((row) => ({ ...row }))
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = rows[index]
  // 幂等：同一个动作连着触发多回，账上只落一条状态，往后几回并入同一条的轨迹。
  if (String(current.status) === target) {
    current['操作轨迹'] = appendTrail(
      String(current['操作轨迹'] ?? ''),
      `重复触发「${action}」，按幂等并入本条，状态保持「${target}」`,
    )
    try {
      saveRows(key, rows)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '操作失败' }
    }
    return { ok: true, message: `${meta.entity}已是「${target}」，重复操作已并入轨迹，不重复记账` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  rows[index] = {
    ...current,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    操作轨迹: appendTrail(String(current['操作轨迹'] ?? ''), `${action}，状态流转为${target}`),
  }
  try {
    saveRows(key, rows)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '操作失败' }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  // 巡检明细以规范化（去重后）条数为准，和排班看板取同一个 patrolSummary，两处一起变。
  const summary = patrolSummary(BUSINESS_TODAY)
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return {
    cards,
    modules,
    patrol: {
      detailCount: summary.detailCount,
      weekCount: summary.weekCount,
      pendingHazards: summary.pendingHazards,
      consistent: summary.consistent,
      distribution: summary.distribution,
      focus: summary.focus,
    },
  }
}
