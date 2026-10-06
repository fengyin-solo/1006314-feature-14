import { reconcileLedgers } from './ledger-domain'
import { canonicalizePatrols, isPlaceholder, toCount } from './patrol-domain'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 老数据兼容（只做增量规整，不改写任何已有业务结论 status/abnormal）：
// - 缺失的扩展字段补空；占位样例文本按「无值」处理；
// - 存量任务计划日期缺失时用完成时间回填；发现问题数强制转非负整数；
// - 待办标志 pending 是派生量，按是否终态重新计算，旧版里算错的由此修正。
function normalizePatrol(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    const next: EntryRow = { ...row }
    const ensure = (field: string, fallback: string | number = '') => {
      if (next[field] === undefined || isPlaceholder(next[field])) next[field] = fallback
    }
    ensure('数据来源', '系统录入')
    ensure('扫描件编号', '')
    ensure('抄表周期', '')
    ensure('处理意见', '')
    ensure('操作轨迹', '')
    if (isPlaceholder(next['巡检路线'])) next['巡检路线'] = ''
    if (isPlaceholder(next['巡检班组'])) next['巡检班组'] = ''
    if (isPlaceholder(next['巡检编号'])) next['巡检编号'] = `PATR-OLD-${row.id}`
    next['发现问题数'] = toCount(next['发现问题数'])
    let planDate = String(next['计划日期'] ?? '').slice(0, 10)
    if (planDate.length !== 10) {
      const done = String(next['完成时间'] ?? '').slice(0, 10)
      planDate = done.length === 10 ? done : ''
    }
    next['计划日期'] = planDate
    next.pending = next.status !== '已上报'
    return next
  })
}

// 一次性把原始数据规整并对账：隐患/派工由规范化巡检派生补齐，幂等可重复执行。
function upgrade(raw: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const data: Record<string, EntryRow[]> = { ...clone(SEED_ROWS), ...clone(raw) }
  data.patrol = normalizePatrol(data.patrol ?? [])

  const { canonical } = canonicalizePatrols(data.patrol)
  const ledgers = reconcileLedgers(canonical, data.hazard ?? [], data.dispatch ?? [])
  data.hazard = ledgers.hazards
  data.dispatch = ledgers.dispatches
  return data
}

function writeStorage(next: Record<string, EntryRow[]>): void {
  // 纯前端没有真正的网络请求；localStorage 写入失败模拟「超时/断线」：允许重试一次，再失败抛出原因。
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        throw new Error('当前环境没有可用的本地存储（localStorage 不可用）')
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return
    } catch (error) {
      lastError = error
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`数据落库失败：已重试一次仍未成功，原因——${reason}`)
}

function readStorage(): Record<string, EntryRow[]> {
  const seed = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return upgrade(seed)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = upgrade(seed)
    try {
      writeStorage(seeded)
    } catch {
      // 首次播种写失败不阻断页面，内存数据仍可用。
    }
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return upgrade(parsed)
  } catch {
    const fallback = upgrade(seed)
    writeStorage(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 原始巡检行（含被去重折叠的行）；明细/排班等一律走 canonicalPatrols()。
export function rawPatrolRows(): EntryRow[] {
  return listRows('patrol')
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  // 保存后重新对账，保证隐患台账与派工清单始终跟随巡检数据。
  if (key === 'patrol') {
    const normalized = normalizePatrol(rows)
    next.patrol = normalized
    const { canonical } = canonicalizePatrols(normalized)
    const ledgers = reconcileLedgers(canonical, next.hazard ?? [], next.dispatch ?? [])
    next.hazard = ledgers.hazards
    next.dispatch = ledgers.dispatches
  }
  cache = next
  writeStorage(next)
}

export function saveLedgers(hazards: EntryRow[], dispatches: EntryRow[]): void {
  const next = { ...allRows(), hazard: hazards, dispatch: dispatches }
  cache = next
  writeStorage(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
