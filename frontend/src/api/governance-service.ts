import { listCollection, listRows, saveCollection, saveRows } from '@/data/local-store'
import {
  addDays,
  buildKeyItems,
  buildSchedule,
  isBlank,
  keptPatrols,
  monthIssueCount,
  normalizePatrols,
  nowStamp,
  sameDayDistribution,
  toIssueCount,
  type DispatchRow,
  type FailureRow,
  type GovernedPatrol,
  type KeyItem,
  type KeyItemBundle,
  type ScheduleBoard,
} from '@/data/governance'
import type { ActionResult, EntryRow } from '@/data/types'

// 治理服务：把巡检、隐患、往期单据、派工、失败台账缝到同一份数据上。
// 页面只读这里的派生结果；所有写操作都经过本文件，保证各入口拿到同一份账。

export type PatrolSnapshot = {
  tasks: GovernedPatrol[]
  kept: GovernedPatrol[]
  totalRaw: number
  totalKept: number
  totalMerged: number
  totalInferred: number
  monthIssues: number
}

export function patrolSnapshot(): PatrolSnapshot {
  const tasks = normalizePatrols(listRows('patrol'))
  const kept = keptPatrols(tasks)
  return {
    tasks,
    kept,
    totalRaw: tasks.length,
    totalKept: kept.length,
    totalMerged: tasks.filter((task) => !task._kept).length,
    totalInferred: kept.filter((task) => task._crewInferred).length,
    monthIssues: monthIssueCount(tasks),
  }
}

export function scheduleBoard(anchor: Date = new Date()): ScheduleBoard {
  return buildSchedule(patrolSnapshot().kept, anchor)
}

export function dayDistribution(anchor: Date = new Date()) {
  return sameDayDistribution(patrolSnapshot().kept, anchor)
}

export function keyItemBundle(): KeyItemBundle {
  return buildKeyItems(
    normalizePatrols(listRows('patrol')),
    listRows('hazard'),
    listCollection<EntryRow>('legacyDocs'),
    listCollection<FailureRow>('failures'),
  )
}

export function findKeyItem(sourceType: KeyItem['sourceType'], sourceCode: string): KeyItem | undefined {
  return keyItemBundle().items.find((item) => item.sourceType === sourceType && item.sourceCode === sourceCode)
}

export function listDispatches(): DispatchRow[] {
  return listCollection<DispatchRow>('dispatches')
}

export function listFailures(): FailureRow[] {
  return listCollection<FailureRow>('failures')
}

export function listLegacyDocs(): EntryRow[] {
  return listCollection<EntryRow>('legacyDocs')
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) ?? 0), 0) + 1
}

function nextDispatchNo(): string {
  const max = listDispatches().reduce((acc, row) => {
    const n = Number(String(row.派工编号).replace(/\D/g, ''))
    return Number.isFinite(n) ? Math.max(acc, n) : acc
  }, 0)
  return `DISP-${String(max + 1).padStart(4, '0')}`
}

function nextHazardNo(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const n = Number(String(row['隐患编号']).replace(/\D/g, ''))
    return Number.isFinite(n) ? Math.max(acc, n) : acc
  }, 0)
  return `HAZA-${String(max + 1).padStart(4, '0')}`
}

// 巡检问题同步隐患整改台账：按来源巡检编号幂等挂账，已存在的只更新问题数、不改状态结论。
export function syncPatrolHazards(): { created: number; updated: number } {
  const hazards = listRows('hazard')
  const next = [...hazards]
  let created = 0
  let updated = 0

  // 直接从存储现算治理结果，避免与刚写入的任务行出现快照不一致导致重复挂账。
  for (const task of keptPatrols(normalizePatrols(listRows('patrol')))) {
    if (task._issues <= 0) {
      continue
    }
    const code = task._code
    const index = next.findIndex((row) => String(row['来源巡检编号'] ?? '') === code)
    if (index >= 0) {
      const prev = toIssueCount(next[index]['上报问题数'])
      if (prev !== task._issues) {
        next[index] = { ...next[index], 上报问题数: task._issues }
        updated += 1
      }
      continue
    }
    const due = task._planDate ? addDays(task._planDate, 7) : ''
    next.push({
      id: nextId(next),
      status: '待整改',
      pending: true,
      abnormal: false,
      隐患编号: nextHazardNo(next),
      隐患部位: `${task._route}（巡检 ${code} 上报）`,
      隐患等级: task._issues >= 3 ? '较大' : '一般',
      整改措施: '按巡检上报问题逐项整改并复测',
      责任人员: isBlank(task['巡检人员']) ? '' : String(task['巡检人员']),
      发现日期: task._planDate,
      整改期限: due,
      整改状态: '待整改',
      来源巡检编号: code,
      上报问题数: task._issues,
    })
    created += 1
  }

  if (created > 0 || updated > 0) {
    saveRows('hazard', next)
  }
  return { created, updated }
}

// 派工清单幂等：同一来源同一动作只落一条，重复触发并入轨迹。
function upsertDispatch(
  sourceType: DispatchRow['来源类型'],
  sourceCode: string,
  action: string,
  summary: string,
  trailDetail: string,
): DispatchRow {
  const rows = listDispatches()
  const stamp = nowStamp()
  const index = rows.findIndex(
    (row) => row.来源类型 === sourceType && row.来源编号 === sourceCode && row.动作 === action,
  )
  if (index >= 0) {
    const target = rows[index]
    target.trail.push({ time: stamp, kind: '重复触发合并', detail: trailDetail })
    target.updatedAt = stamp
    if (!target.摘要 && summary) {
      target.摘要 = summary
    }
    saveCollection('dispatches', rows)
    return target
  }
  const created: DispatchRow = {
    id: nextId(rows),
    派工编号: nextDispatchNo(),
    来源类型: sourceType,
    来源编号: sourceCode,
    动作: action,
    摘要: summary,
    处理意见: '',
    状态: '待处理',
    createdAt: stamp,
    updatedAt: stamp,
    trail: [{ time: stamp, kind: '建账', detail: trailDetail }],
  }
  rows.push(created)
  saveCollection('dispatches', rows)
  return created
}

export type ReportResult = ActionResult & { dispatchNo?: string; retried?: boolean }

// 巡检上报：更新任务结论（幂等重复提交不改变结论）、累加问题数，同步隐患台账并落派工。
function executeReport(id: number, addedIssues: number): ReportResult {
  const rows = listRows('patrol')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的巡检任务` }
  }
  const current = rows[index]
  const code = String(current['巡检编号'] ?? id)
  const before = toIssueCount(current['发现问题数'])
  const nextIssues = before + addedIssues
  const repeat = String(current.status) === '已上报'

  const updated: EntryRow = {
    ...current,
    发现问题数: nextIssues,
    status: '已上报',
    // 巡检状态机中「已上报」是末态；待整改挂在隐患台账上，不在巡检任务上重复计数。
    pending: false,
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows('patrol', nextRows)

  const sync = syncPatrolHazards()

  const route = String(current['巡检路线'] ?? '')
  const date = String(current['计划日期'] ?? '')
  const dispatch = upsertDispatch(
    'patrol',
    code,
    '巡检问题整改',
    `${route} · ${date} 巡检上报，累计问题 ${nextIssues} 项`,
    repeat
      ? `同一巡检任务重复上报 ${addedIssues} 项，并入本单轨迹，不重复落账；隐患台账问题数同步为 ${nextIssues}`
      : `巡检上报 ${addedIssues} 项，隐患台账同步${sync.created > 0 ? `新建 ${sync.created} 条、` : ''}${sync.updated > 0 ? `更新 ${sync.updated} 条` : '已存在对应条目'}`,
  )

  return {
    ok: true,
    dispatchNo: String(dispatch.派工编号),
    message: repeat
      ? `巡检 ${code} 已上报过，本次 ${addedIssues} 项并入派工 ${dispatch.派工编号} 的轨迹，隐患问题数同步为 ${nextIssues}`
      : `巡检 ${code} 已上报 ${addedIssues} 项，隐患台账已挂待整改，派工单号 ${dispatch.派工编号}`,
  }
}

// 传输层：超时/断线自动重试一次；再失败把两次原因记进失败台账，网络恢复后原处重试。
export type TransportMode = 'online' | 'timeout' | 'offline'
let transportMode: TransportMode = 'online'

export function getTransportMode(): TransportMode {
  return transportMode
}

export function setTransportMode(mode: TransportMode): void {
  transportMode = mode
}

function transportReason(attempt: number): string {
  const env = transportMode
  if (env === 'online') {
    return ''
  }
  if (env === 'timeout') {
    return `第${attempt}次请求超时（30s 无响应）`
  }
  return `第${attempt}次请求失败：网络已断开（ERR_NETWORK_CHANGED）`
}

function recordFailure(action: string, sourceType: string, sourceCode: string, reason: string, payload: string): FailureRow {
  const rows = listFailures()
  const created: FailureRow = {
    id: nextId(rows),
    时间: nowStamp(),
    业务动作: action,
    来源类型: sourceType,
    来源编号: sourceCode,
    原因: reason,
    已解决: false,
    解决时间: '',
    载荷: payload,
  }
  rows.push(created)
  saveCollection('failures', rows)
  return created
}

export function reportPatrolIssue(id: number, addedIssues: number): ReportResult {
  const rows = listRows('patrol')
  const target = rows.find((row) => Number(row.id) === id)
  const sourceCode = target ? String(target['巡检编号'] ?? id) : String(id)
  const payload = JSON.stringify({ kind: 'patrolReport', id, addedIssues })

  const fail = () => {
    const r1 = transportReason(1)
    if (!r1) {
      return null
    }
    const r2 = transportReason(2)
    recordFailure('巡检问题上报', 'patrol', sourceCode, `${r1}；自动重试一次仍失败：${r2}，未落账。`, payload)
    return { ok: false as const, message: `${r1}；自动重试一次仍失败：${r2}。未写入半截账，已记入关键条目，网络恢复后可重试。` }
  }

  const blocked = fail()
  if (blocked) {
    return blocked
  }
  return executeReport(id, addedIssues)
}

export function retryFailure(failureId: number): ReportResult {
  const rows = listFailures()
  const index = rows.findIndex((row) => Number(row.id) === failureId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条失败记录' }
  }
  const failure = rows[index]

  const r1 = transportReason(1)
  if (r1) {
    rows[index] = { ...failure, 原因: `${failure.原因}；${nowStamp()} 手动重试仍失败：${transportReason(1)}（自动再试一次：${transportReason(2)}）` }
    saveCollection('failures', rows)
    return { ok: false, message: `重试失败：${transportReason(2)}，原因已补记，可在网络恢复后再次重试。` }
  }

  let result: ReportResult = { ok: true, message: '重试成功' }
  if (failure.载荷) {
    try {
      const payload = JSON.parse(failure.载荷) as { kind?: string; id?: number; addedIssues?: number }
      if (payload.kind === 'patrolReport' && typeof payload.id === 'number') {
        result = executeReport(payload.id, payload.addedIssues ?? 0)
      }
    } catch {
      result = { ok: false, message: '失败载荷无法解析，已保留原始记录' }
    }
  }

  if (!result.ok) {
    return result
  }

  rows[index] = { ...failure, 已解决: true, 解决时间: nowStamp(), 原因: `${failure.原因}；重试成功（${result.message}）` }
  saveCollection('failures', rows)
  return { ...result, retried: true, message: `重试成功，原单已落账：${result.message}` }
}

// 处理意见回写派工清单：关键条目页与派工清单页都调这一个，两边取到同一份。
// 关键条目页按条目默认动作定位派工单；派工清单页按单子自身动作定位，保证同一来源不同动作不串单。
export function saveOpinion(
  sourceType: KeyItem['sourceType'],
  sourceCode: string,
  opinion: string,
  actionOverride?: string,
): ReportResult {
  const item = findKeyItem(sourceType, sourceCode)
  const action = actionOverride ?? item?.defaultAction ?? '事项处理'
  const summary = item?.title ?? sourceCode
  const stamp = nowStamp()

  const rows = listDispatches()
  const index = rows.findIndex(
    (row) => row.来源类型 === sourceType && row.来源编号 === sourceCode && row.动作 === action,
  )
  if (index >= 0) {
    const target = rows[index]
    target.处理意见 = opinion
    target.状态 = opinion.trim() === '' ? target.状态 : '已闭环'
    target.updatedAt = stamp
    target.trail.push({
      time: stamp,
      kind: '处理意见回写',
      detail: opinion.trim() === '' ? '处理意见清空' : `处理意见：${opinion}`,
    })
    saveCollection('dispatches', rows)
    return { ok: true, message: `处理意见已回写派工单 ${target.派工编号}，各入口同步可见` }
  }

  const created: DispatchRow = {
    id: nextId(rows),
    派工编号: nextDispatchNo(),
    来源类型: sourceType,
    来源编号: sourceCode,
    动作: action,
    摘要: summary,
    处理意见: opinion,
    状态: opinion.trim() === '' ? '待处理' : '已闭环',
    createdAt: stamp,
    updatedAt: stamp,
    trail: [
      { time: stamp, kind: '建账', detail: `由关键条目（${item?.kindLabel ?? '事项'}）转入派工清单` },
      ...(opinion.trim() ? [{ time: stamp, kind: '处理意见回写' as const, detail: `处理意见：${opinion}` }] : []),
    ],
  }
  rows.push(created)
  saveCollection('dispatches', rows)
  return { ok: true, message: `已新建派工单 ${created.派工编号} 并回写处理意见，各入口取同一份` }
}

// 概览与看板唯一口径：同一份巡检治理数、同一份关键条目数。
export function singleSourceCounts() {
  const patrol = patrolSnapshot()
  const items = keyItemBundle()
  return {
    patrolRaw: patrol.totalRaw,
    patrolKept: patrol.totalKept,
    patrolMerged: patrol.totalMerged,
    patrolInferred: patrol.totalInferred,
    keyTotal: items.total,
  }
}

// 应用启动时执行一次：巡检问题数补齐挂账（幂等，只补不改结论）。
export function initGovernance(): void {
  syncPatrolHazards()
}
