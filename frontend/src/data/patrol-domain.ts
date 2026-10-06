import type { EntryRow } from '@/data/types'

// 排班/台账域逻辑：纯函数，不碰 localStorage，方便对账与单测。
// 业务基准日固定为示例数据的当前日，避免随访问设备的系统时钟漂移导致演示周错位。
export const BUSINESS_TODAY = '2026-10-06'

export const TERMINAL_PATROL_STATUS = '已上报'

// 路线 → 责任班组的归属表：早年没有巡检班组的存量任务按这张表推定。
// 推定规则（确定性、可复核）：
// 1. 路线名显式带舱室归属的，走固定归属表；
// 2. 固定表没有的，按路线名首个关键字（东/西/南/北/中）落到对应分管班组；
// 3. 仍无法判断的，统一归「综合巡检班」兜底，不允许班组为空。
export const ROUTE_TEAM_MAP: Record<string, string> = {
  东段电缆舱: '巡检一班',
  西段综合舱: '巡检二班',
  南段燃气舱: '巡检三班',
  北段给水舱: '巡检三班',
}

const KEYWORD_TEAM: Array<[string, string]> = [
  ['东', '巡检一班'],
  ['西', '巡检二班'],
  ['南', '巡检三班'],
  ['北', '巡检三班'],
  ['中', '综合巡检班'],
]

export const INFER_TEAM_TAG = '推定班组'
export const BACKFILL_TAG = '按计划日期回填'

export function inferTeam(route: string): string {
  if (ROUTE_TEAM_MAP[route]) {
    return ROUTE_TEAM_MAP[route]
  }
  for (const [keyword, team] of KEYWORD_TEAM) {
    if (route.includes(keyword)) {
      return team
    }
  }
  return '综合巡检班'
}

export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.includes('样例')
}

export function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

export function dateText(value: string | Date): string {
  const d = typeof value === 'string' ? parseDate(value) : value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(value: string, days: number): string {
  const d = parseDate(value)
  d.setDate(d.getDate() + days)
  return dateText(d)
}

// ISO 周以周一为一周起点，返回该周 7 天的日期串。
export function weekDates(anchor: string): string[] {
  const d = parseDate(anchor)
  const weekday = (d.getDay() + 6) % 7 // 周一=0
  d.setDate(d.getDate() - weekday)
  return Array.from({ length: 7 }, (_, i) => addDays(dateText(d), i))
}

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export type CanonicalPatrol = EntryRow & {
  合并自: string // 被并入本条的重复巡检编号，分号分隔
  是否推定班组: boolean
}

type RawPatrol = EntryRow

// 同一路线同一天重复排班只留一条，按巡检编号去重：
// 保留巡检编号排序最靠前（通常即编号最小/最早录入）的一条为主记录，其余并入其「合并自」轨迹。
// 注意：原始行仍物理保留在存储里（数据来源=重复折叠），明细/排班/概览只认规范化后的结果，
// 因此排班视图任务数与明细条数天然对得上，且审计可追溯被并掉的编号。
export function canonicalizePatrols(rawRows: RawPatrol[]): {
  canonical: CanonicalPatrol[]
  dropped: RawPatrol[]
} {
  const valid = rawRows.filter((row) => String(row['计划日期'] ?? '').slice(0, 10).length === 10)
  const sorted = [...valid].sort((a, b) => {
    const ka = String(a['巡检编号'] ?? '')
    const kb = String(b['巡检编号'] ?? '')
    return ka.localeCompare(kb, 'zh-Hans-CN')
  })

  const kept = new Map<string, CanonicalPatrol>()
  const dropped: RawPatrol[] = []

  for (const row of sorted) {
    const route = String(row['巡检路线'] ?? '').trim()
    const day = String(row['计划日期']).slice(0, 10)
    const key = `${route}@${day}`
    const existing = kept.get(key)
    if (!existing) {
      kept.set(key, { ...row, 计划日期: day, 合并自: '', 是否推定班组: false })
    } else {
      const mergedNo = String(row['巡检编号'] ?? `id-${row.id}`)
      existing['合并自'] = existing['合并自'] ? `${existing['合并自']};${mergedNo}` : mergedNo
      const tail = `与${existing['巡检编号']}同路线同天重复，按巡检编号去重并入本条`
      existing['操作轨迹'] = appendTrail(String(existing['操作轨迹'] ?? ''), tail)
      dropped.push(row)
    }
  }

  const canonical: CanonicalPatrol[] = [...kept.values()].map((row) => {
    const team = String(row['巡检班组'] ?? '').trim()
    const inferred = !team || isPlaceholder(team)
    const result: CanonicalPatrol = {
      ...row,
      巡检班组: inferred ? inferTeam(String(row['巡检路线'] ?? '')) : team,
      是否推定班组: inferred,
      发现问题数: toCount(row['发现问题数']),
      pending: row.status !== TERMINAL_PATROL_STATUS,
    }
    return result
  })

  canonical.sort((a, b) => {
    const da = String(a['计划日期'])
    const db = String(b['计划日期'])
    if (da !== db) return da < db ? -1 : 1
    return String(a['巡检班组']).localeCompare(String(b['巡检班组']), 'zh-Hans-CN')
  })

  return { canonical, dropped }
}

export function appendTrail(trail: string, line: string): string {
  const stamp = nowStamp()
  const entry = `${stamp} ${line}`
  return trail ? `${trail}；${entry}` : entry
}

export function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type TeamCell = {
  team: string
  date: string
  tasks: CanonicalPatrol[]
}

export type PatrolMatrix = {
  dates: string[]
  teams: string[]
  cells: TeamCell[][] // [teamIndex][dateIndex]
  total: number
}

export function buildPatrolMatrix(rows: CanonicalPatrol[], anchor: string): PatrolMatrix {
  const dates = weekDates(anchor)
  const inWeek = rows.filter((r) => dates.includes(String(r['计划日期'])))
  const teams = [...new Set(inWeek.map((r) => String(r['巡检班组'])))]
    .concat(...['巡检一班', '巡检二班', '巡检三班', '综合巡检班'])
  const teamList = [...new Set(teams)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

  const cells = teamList.map((team) =>
    dates.map((date) => ({
      team,
      date,
      tasks: inWeek
        .filter((r) => String(r['巡检班组']) === team && String(r['计划日期']) === date)
        .sort((a, b) => String(a['巡检路线']).localeCompare(String(b['巡检路线']), 'zh-Hans-CN'))
        .map((r) => ({ ...r })),
    })),
  )

  return { dates, teams: teamList, cells, total: inWeek.length }
}

export type DayBucket = { date: string; total: number; teams: number }

// 概览的同日分布：以基准日为右端，回看 14 天，统计每天任务数与涉及班组数。
export function buildDayDistribution(rows: CanonicalPatrol[], endDate = BUSINESS_TODAY, span = 14): DayBucket[] {
  const start = addDays(endDate, -(span - 1))
  return Array.from({ length: span }, (_, i) => {
    const date = addDays(start, i)
    const dayRows = rows.filter((r) => String(r['计划日期']) === date)
    return {
      date,
      total: dayRows.length,
      teams: new Set(dayRows.map((r) => String(r['巡检班组']))).size,
    }
  })
}

export type FocusItem = {
  kind: '班组超载' | '路线空窗' | '重复排班' | '待整改隐患'
  title: string
  detail: string
  refId: string
  module: 'patrol' | 'hazard'
  level: '高' | '中'
}

// 关键条目：班组一天 ≥3 条视为超载；同一路线超过 3 天无人去视为空窗；重复折叠与待整改隐患各列一类。
export function buildFocusItems(
  rows: CanonicalPatrol[],
  distribution: DayBucket[],
  pendingHazards: EntryRow[],
): FocusItem[] {
  const items: FocusItem[] = []

  for (const bucket of distribution) {
    const byTeam = new Map<string, number>()
    rows
      .filter((r) => String(r['计划日期']) === bucket.date)
      .forEach((r) => byTeam.set(String(r['巡检班组']), (byTeam.get(String(r['巡检班组'])) ?? 0) + 1))
    for (const [team, count] of byTeam) {
      if (count >= 3) {
        items.push({
          kind: '班组超载',
          level: '高',
          title: `${team} ${bucket.date} 一天被排 ${count} 条路线`,
          detail: `当天该班组承担 ${count} 条巡检任务，存在排班冲突`,
          refId: bucket.date,
          module: 'patrol',
        })
      }
    }
  }

  const routes = [...new Set(rows.map((r) => String(r['巡检路线'])))]
  for (const route of routes) {
    const days = rows
      .filter((r) => String(r['巡检路线']) === route)
      .map((r) => String(r['计划日期']))
      .sort()
    for (let i = 1; i < days.length; i += 1) {
      const gap = Math.round((parseDate(days[i]).getTime() - parseDate(days[i - 1]).getTime()) / 86400000) - 1
      if (gap > 3) {
        items.push({
          kind: '路线空窗',
          level: '高',
          title: `${route} 连续 ${gap} 天无人巡检`,
          detail: `${days[i - 1]} 至 ${days[i]} 之间空窗 ${gap} 天`,
          refId: route,
          module: 'patrol',
        })
      }
    }
  }

  for (const row of rows) {
    if (row['合并自']) {
      items.push({
        kind: '重复排班',
        level: '中',
        title: `${String(row['计划日期'])} ${String(row['巡检路线'])} 重复排班已去重`,
        detail: `保留 ${String(row['巡检编号'])}，并入：${String(row['合并自'])}`,
        refId: String(row['巡检编号']),
        module: 'patrol',
      })
    }
  }

  for (const hz of pendingHazards) {
    items.push({
      kind: '待整改隐患',
      level: String(hz['隐患等级']) === '重大' ? '高' : '中',
      title: `${String(hz['隐患编号'])} ${String(hz['隐患部位'])} 待整改`,
      detail: hz['来源巡检编号']
        ? `来自巡检 ${String(hz['来源巡检编号'])}，整改期限 ${String(hz['整改期限'])}`
        : `整改期限 ${String(hz['整改期限'])}`,
      refId: String(hz['隐患编号']),
      module: 'hazard',
    })
  }

  const order: Record<FocusItem['kind'], number> = {
    班组超载: 0,
    路线空窗: 1,
    待整改隐患: 2,
    重复排班: 3,
  }
  return items.sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}
