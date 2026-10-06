import type { DispatchRow, FailureRow } from './governance'
import { SEED_LEGACY_DOCS, SEED_ROWS } from './seed'
import type { EntryRow, GenericRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：在业务模块之外增加治理数据集（往期单据、派工清单、传输失败台账）。
// 老账套（v1）的原始记录原样搬迁、一条不删，只在治理层派生去重与推定结果。
const STORAGE_KEY = 'urban-utility-tunnel:entries:v2'
const LEGACY_STORAGE_KEY = 'urban-utility-tunnel:entries'

export const GOVERNANCE_KEYS = ['legacyDocs', 'dispatches', 'failures'] as const
export type GovernanceKey = (typeof GOVERNANCE_KEYS)[number]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type Database = {
  modules: Record<string, EntryRow[]>
  legacyDocs: EntryRow[]
  dispatches: DispatchRow[]
  failures: FailureRow[]
}

const seedDispatches: DispatchRow[] = [
  {
    id: 1,
    派工编号: 'DISP-0001',
    来源类型: 'patrol',
    来源编号: 'PATR-0014',
    动作: '巡检问题整改',
    摘要: '东湖配电舱 3#配电柜接线端子巡检上报 3 项，挂 HAZA-0002 待整改',
    处理意见: '',
    状态: '处理中',
    createdAt: '2026-10-08 14:20:00',
    updatedAt: '2026-10-08 14:20:00',
    trail: [
      { time: '2026-10-08 14:20:00', kind: '建账', detail: '巡检上报触发派工，台账挂待整改' },
      { time: '2026-10-08 14:20:05', kind: '重复触发合并', detail: '同一动作再次上报，并入本单，不重复落账' },
    ],
  },
]

const seedFailures: FailureRow[] = [
  {
    id: 1,
    时间: '2026-10-04 09:31:12',
    业务动作: '巡检问题上报',
    来源类型: 'patrol',
    来源编号: 'PATR-0101',
    原因: '首次请求超时（30s 无响应）；自动重试一次仍失败：网络已断开（ERR_NETWORK_CHANGED），未落账。',
    已解决: true,
    解决时间: '2026-10-04 10:02:40',
    载荷: '',
  },
]

function buildSeedDatabase(): Database {
  return {
    modules: clone(SEED_ROWS),
    legacyDocs: clone(SEED_LEGACY_DOCS),
    dispatches: clone(seedDispatches),
    failures: clone(seedFailures),
  }
}

function migrateV1(rawV1: string, fallback: Database): Database {
  // 旧账套原样搬迁业务模块原始记录；v2 新增的巡检/隐患/能耗/治理数据以新种子为准。
  const merged: Database = clone(fallback)
  try {
    const v1 = JSON.parse(rawV1) as Record<string, EntryRow[]>
    for (const [key, rows] of Object.entries(v1)) {
      if (key in fallback.modules) {
        merged.modules[key] = rows
      }
    }
  } catch {
    // 旧账套损坏时不阻断，沿用 v2 种子。
  }
  return merged
}

function readStorage(): Database {
  const fallback = buildSeedDatabase()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    let initial = fallback
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      initial = migrateV1(legacy, fallback)
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Database>
    return {
      modules: { ...fallback.modules, ...(parsed.modules ?? {}) },
      legacyDocs: Array.isArray(parsed.legacyDocs) ? (parsed.legacyDocs as EntryRow[]) : fallback.legacyDocs,
      dispatches: Array.isArray(parsed.dispatches) ? (parsed.dispatches as DispatchRow[]) : fallback.dispatches,
      failures: Array.isArray(parsed.failures) ? (parsed.failures as FailureRow[]) : fallback.failures,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Database | null = null

// 落账后回调：由 api/events 注册，避免数据层反向依赖 api 层形成环。
let changeHook: (() => void) | null = null
export function setChangeHook(hook: (() => void) | null): void {
  changeHook = hook
}
function notifyChanged(): void {
  if (changeHook) {
    changeHook()
  }
}

function db(): Database {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db()))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  return db().modules
}

export function listRows(key: string): EntryRow[] {
  return db().modules[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  db().modules[key] = rows
  cache = db()
  persist()
  notifyChanged()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function listCollection<T extends GenericRow>(key: GovernanceKey): T[] {
  const value = db()[key] as unknown as T[]
  return value
}

export function saveCollection(key: GovernanceKey, rows: GenericRow[]): void {
  const database = db()
  if (key === 'legacyDocs') {
    database.legacyDocs = rows as unknown as EntryRow[]
  } else if (key === 'dispatches') {
    database.dispatches = rows as unknown as DispatchRow[]
  } else {
    database.failures = rows as unknown as FailureRow[]
  }
  persist()
  notifyChanged()
}

export function resetGovernance(): void {
  const database = db()
  database.legacyDocs = clone(SEED_LEGACY_DOCS)
  database.dispatches = clone(seedDispatches)
  database.failures = clone(seedFailures)
  persist()
}

export function storageKey(): string {
  return STORAGE_KEY
}
