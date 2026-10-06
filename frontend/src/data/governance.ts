import type { EntryRow } from './types'

// 治理层：去重、回填、班组推定、排班铺格、关键条目汇总都在这里算。
// 原则：原始巡检记录一条不删，治理结果为派生视图；既有状态结论不改写，只做补挂与计数同步。

export type GovernedPatrol = EntryRow & {
  _code: string // 巡检编号
  _route: string // 巡检路线（空值归为“未指定路线”）
  _crew: string // 巡检班组（可能是推定的）
  _crewInferred: boolean // 班组是否按路线归属推定
  _planDate: string // 回填后的计划日期 YYYY-MM-DD，空串表示无法排期
  _dateBackfilled: boolean // 计划日期是否由完成时间回填
  _issues: number // 发现问题数（兜底转数字）
  _kept: boolean // 去重后是否保留进排班
  _dupKind: '' | '同巡检编号重复' | '同路线同日重复'
  _mergedInto: string // 被并入哪条巡检编号
}

export type ScheduleTask = GovernedPatrol

export type ScheduleCell = {
  team: string
  date: string
  tasks: ScheduleTask[]
}

export type OverloadHint = {
  team: string
  date: string
  count: number
  routes: string[]
}

export type GapHint = {
  route: string
  maxGap: number // 本周内最长连续无人天数
  missingDays: string[]
}

export type ScheduleBoard = {
  weekStart: string
  days: { date: string; weekday: string; isToday: boolean }[]
  teams: string[]
  cells: Record<string, ScheduleCell> // key = `${班组}|${日期}`
  overloads: OverloadHint[]
  gaps: GapHint[]
  weekTaskCount: number
}

export type KeyItemKind = 'duplicate' | 'inferred' | 'hazard' | 'legacy' | 'failure'

export type KeyItem = {
  kind: KeyItemKind
  kindLabel: string
  code: string // 条目编号
  title: string
  detail: string
  date: string
  sourceType: 'patrol' | 'hazard' | 'legacy' | 'failure'
  sourceCode: string
  defaultAction: string
}

export type KeyItemBundle = {
  items: KeyItem[]
  groups: { kind: KeyItemKind; label: string; count: number }[]
  total: number
}

export type LegacyDoc = EntryRow

export type DispatchTrailEntry = {
  time: string
  kind: string
  detail: string
}

export type DispatchRow = {
  id: number
  派工编号: string
  来源类型: 'patrol' | 'hazard' | 'legacy' | 'failure'
  来源编号: string
  动作: string
  摘要: string
  处理意见: string
  状态: '待处理' | '处理中' | '已闭环'
  createdAt: string
  updatedAt: string
  trail: DispatchTrailEntry[]
}

export type FailureRow = {
  id: number
  时间: string
  业务动作: string
  来源类型: string
  来源编号: string
  原因: string
  已解决: boolean
  解决时间: string
  载荷: string // JSON，网络恢复后按原载荷重试；空串表示仅需核对关闭
}

// 老数据兼容与既有结论处理的交代，关键条目页直接渲染。
export const GOVERNANCE_NOTES: { title: string; body: string }[] = [
  {
    title: '存储升级与旧数据搬迁',
    body: '本地账套升级到 v2。旧账套中的原始记录（含早年纸面后补录的）原样搬入、一条不删，只在治理层派生去重与推定结果，旧账套保留不覆盖。',
  },
  {
    title: '同一路线同一天去重',
    body: '先按巡检编号去重（同编号只留 id 最小的一条），再按“巡检路线 + 计划日期”去重；同日同路线优先保留班组明确、问题数多的一条。被并记录不删除，挂“已并入”痕迹，可在明细页勾选查看。',
  },
  {
    title: '存量任务按计划日期回填',
    body: '计划日期缺失时用完成时间回填并标记“日期回填”；两者都缺失的任务不进排班，留在明细里待人工补录。',
  },
  {
    title: '早年无班组按路线归属推定',
    body: '先用全量“有班组”记录统计每条路线最常归属的班组作为责任班组；统计不到的（路线从未登记过班组）按路线名稳定哈希在现有班组中兜底推定，保证同一历日每次推定结果一致。所有推定条目标“推定”，不回写原始记录。',
  },
  {
    title: '巡检问题同步隐患台账',
    body: '发现问题数大于 0 的巡检任务按来源巡检编号在隐患整改台账挂“待整改”条目，幂等：同一巡检编号只挂一条，后续上报只同步问题数，不重复建账。',
  },
  {
    title: '既有结论不改写',
    body: '历史单据的状态结论（已验收、已上报、已完工等）一律保持原样，不做任何改写；同步只补挂缺失条目与更新问题计数，不动状态。',
  },
  {
    title: '往期单据搬入规则',
    body: '电子往期单据按抄表周期逐月搬入建账；早期只有纸面的，按扫描件编号作为单据编号建账，并注明“纸面扫描”来源。',
  },
  {
    title: '超时与断线',
    body: '上报与回写遇到超时或断线自动重试一次；重试仍失败的，不落半截账，把两次失败原因完整记入关键条目，网络恢复后可在原处手动重试。',
  },
]

const PLACEHOLDER_RE = /样例/

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

// 旧占位种子（“xx样例1”）视为缺省，参与推定而不是当成真实班组/路线归属。
function isPlaceholder(value: unknown): boolean {
  return !isBlank(value) && PLACEHOLDER_RE.test(String(value))
}

export function cleanCrew(value: unknown): string {
  if (isBlank(value) || isPlaceholder(value)) {
    return ''
  }
  return String(value).trim()
}

export function cleanRoute(value: unknown): string {
  if (isBlank(value) || isPlaceholder(value)) {
    return '未指定路线'
  }
  return String(value).trim()
}

export function toIssueCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return null
  }
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null
  }
  return date
}

export function isValidDate(value: unknown): value is string {
  return parseDate(value) !== null
}

// 完成时间可能是“2024-02-19 10:40”这种带时分的旧格式，取前 10 位日期部分兜底。
export function extractDate(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  const head = value.trim().slice(0, 10)
  return isValidDate(head) ? head : ''
}

export function formatDateInput(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value)
  if (!date) {
    return value
  }
  date.setDate(date.getDate() + days)
  return formatDateInput(date)
}

export function todayInput(): string {
  return formatDateInput(new Date())
}

export function nowStamp(): string {
  const now = new Date()
  const date = formatDateInput(now)
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${date} ${hh}:${mm}:${ss}`
}

// 以周一为一周起点。
export function mondayOf(anchor: Date): Date {
  const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const weekday = (date.getDay() + 6) % 7 // 周一=0
  date.setDate(date.getDate() - weekday)
  return date
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function weekDays(weekStartValue: string): { date: string; weekday: string; isToday: boolean }[] {
  const today = todayInput()
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStartValue, i)
    return { date, weekday: WEEKDAY_LABELS[i], isToday: date === today }
  })
}

// 稳定哈希：同一历日路线没有任何归属记录时，兜底推定结果也要可复现。
function stableIndex(text: string, modulo: number): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 9973
  }
  return hash % modulo
}

export function buildCrewOwnership(raw: EntryRow[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const row of raw) {
    const crew = cleanCrew(row['巡检班组'])
    const route = cleanRoute(row['巡检路线'])
    if (!crew || route === '未指定路线') {
      continue
    }
    const routeVotes = votes.get(route) ?? new Map<string, number>()
    routeVotes.set(crew, (routeVotes.get(crew) ?? 0) + 1)
    votes.set(route, routeVotes)
  }
  const ownership = new Map<string, string>()
  for (const [route, routeVotes] of votes) {
    let best = ''
    let bestCount = -1
    for (const [crew, count] of routeVotes) {
      if (count > bestCount || (count === bestCount && crew < best)) {
        best = crew
        bestCount = count
      }
    }
    ownership.set(route, best)
  }
  return ownership
}

export function normalizePatrols(raw: EntryRow[]): GovernedPatrol[] {
  const ownership = buildCrewOwnership(raw)
  const knownTeams = [...new Set(raw.map((row) => cleanCrew(row['巡检班组'])).filter(Boolean))].sort()

  const stamped: GovernedPatrol[] = raw.map((row) => {
    const code = isBlank(row['巡检编号']) ? `缺编号#${row.id}` : String(row['巡检编号']).trim()
    const route = cleanRoute(row['巡检路线'])
    const explicitCrew = cleanCrew(row['巡检班组'])
    const planRaw = row['计划日期']
    const backfillSource = extractDate(row['完成时间'])
    const dateBackfilled = !isValidDate(planRaw) && backfillSource !== ''
    const planDate = isValidDate(planRaw) ? planRaw : backfillSource
    let crew = explicitCrew
    let crewInferred = false
    if (!crew) {
      crewInferred = true
      const owned = ownership.get(route)
      crew = owned ?? (knownTeams.length ? knownTeams[stableIndex(route, knownTeams.length)] : '未排班班组')
    }
    return {
      ...row,
      _code: code,
      _route: route,
      _crew: crew,
      _crewInferred: crewInferred,
      _planDate: planDate,
      _dateBackfilled: dateBackfilled,
      _issues: toIssueCount(row['发现问题数']),
      _kept: true,
      _dupKind: '',
      _mergedInto: '',
    }
  })

  // 第一层：按巡检编号去重，同编号只留 id 最小的一条。
  const codeWinner = new Map<string, GovernedPatrol>()
  for (const task of stamped) {
    const winner = codeWinner.get(task._code)
    if (!winner || Number(task.id) < Number(winner.id)) {
      codeWinner.set(task._code, task)
    }
  }
  for (const task of stamped) {
    if (codeWinner.get(task._code) !== task) {
      task._kept = false
      task._dupKind = '同巡检编号重复'
      task._mergedInto = codeWinner.get(task._code)!._code
    }
  }

  // 第二层：同路线同计划日期只留一条；班组明确优先、问题数多优先、id 小优先。
  const dayWinner = new Map<string, GovernedPatrol>()
  const survivors = stamped.filter((task) => task._kept)
  for (const task of survivors) {
    if (!task._planDate || task._route === '未指定路线') {
      continue
    }
    const key = `${task._route}|${task._planDate}`
    const winner = dayWinner.get(key)
    if (!winner) {
      dayWinner.set(key, task)
      continue
    }
    const score = (candidate: GovernedPatrol): number[] => [
      candidate._crewInferred ? 0 : 1,
      candidate._issues,
      -Number(candidate.id),
    ]
    const a = score(task)
    const b = score(winner)
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
      dayWinner.set(key, task)
    }
  }
  for (const task of survivors) {
    if (!task._planDate || task._route === '未指定路线') {
      continue
    }
    const key = `${task._route}|${task._planDate}`
    if (dayWinner.get(key) !== task) {
      task._kept = false
      task._dupKind = '同路线同日重复'
      task._mergedInto = dayWinner.get(key)!._code
    }
  }

  return stamped.sort((a, b) => {
    if (a._planDate !== b._planDate) {
      return a._planDate < b._planDate ? -1 : 1
    }
    return Number(a.id) - Number(b.id)
  })
}

export function keptPatrols(tasks: GovernedPatrol[]): GovernedPatrol[] {
  return tasks.filter((task) => task._kept)
}

export function buildSchedule(tasks: ScheduleTask[], anchor: Date = new Date()): ScheduleBoard {
  const weekStartDate = mondayOf(anchor)
  const weekStart = formatDateInput(weekStartDate)
  const days = weekDays(weekStart)
  const daySet = new Set(days.map((day) => day.date))

  const active = tasks.filter((task) => task._kept && task._planDate && daySet.has(task._planDate))
  const teams = [...new Set(active.map((task) => task._crew))].sort()

  const cells: Record<string, ScheduleCell> = {}
  for (const team of teams) {
    for (const day of days) {
      cells[`${team}|${day.date}`] = { team, date: day.date, tasks: [] }
    }
  }
  for (const task of active) {
    cells[`${task._crew}|${task._planDate}`].tasks.push(task)
  }

  const overloads: OverloadHint[] = []
  for (const cell of Object.values(cells)) {
    if (cell.tasks.length > 1) {
      overloads.push({
        team: cell.team,
        date: cell.date,
        count: cell.tasks.length,
        routes: [...new Set(cell.tasks.map((task) => task._route))],
      })
    }
  }

  // 空班提示：本周内某条路线连续三天及以上没人去。
  const routeDays = new Map<string, Set<string>>()
  for (const task of active) {
    const set = routeDays.get(task._route) ?? new Set<string>()
    set.add(task._planDate)
    routeDays.set(task._route, set)
  }
  const gaps: GapHint[] = []
  for (const [route, covered] of routeDays) {
    let run: string[] = []
    let longest: string[] = []
    for (const day of days) {
      if (!covered.has(day.date)) {
        run.push(day.date)
        if (run.length > longest.length) {
          longest = run
        }
      } else {
        run = []
      }
    }
    if (longest.length >= 3) {
      gaps.push({ route, maxGap: longest.length, missingDays: longest })
    }
  }

  return {
    weekStart,
    days,
    teams,
    cells,
    overloads,
    gaps: gaps.sort((a, b) => b.maxGap - a.maxGap),
    weekTaskCount: active.length,
  }
}

export type DayDistribution = { date: string; weekday: string; isToday: boolean; count: number }

export function sameDayDistribution(tasks: ScheduleTask[], anchor: Date = new Date()): DayDistribution[] {
  const board = buildSchedule(tasks, anchor)
  return board.days.map((day) => ({
    ...day,
    count: board.teams.reduce((sum, team) => sum + board.cells[`${team}|${day.date}`].tasks.length, 0),
  }))
}

const GROUP_LABEL: Record<KeyItemKind, string> = {
  duplicate: '重复排班被并',
  inferred: '班组归属推定',
  hazard: '巡检问题挂账隐患',
  legacy: '往期单据搬入',
  failure: '超时断线记录',
}

export function buildKeyItems(
  tasks: GovernedPatrol[],
  hazards: EntryRow[],
  legacyDocs: EntryRow[],
  failures: FailureRow[],
): KeyItemBundle {
  const items: KeyItem[] = []

  for (const task of tasks.filter((item) => !item._kept)) {
    items.push({
      kind: 'duplicate',
      kindLabel: GROUP_LABEL.duplicate,
      code: task._code,
      title: `${task._route} · ${task._planDate || '无计划日期'}`,
      detail: `${task._dupKind}，已并入 ${task._mergedInto}，原始记录保留`,
      date: task._planDate,
      sourceType: 'patrol',
      sourceCode: task._code,
      defaultAction: '重复排班核查',
    })
  }

  for (const task of tasks.filter((item) => item._kept && item._crewInferred)) {
    items.push({
      kind: 'inferred',
      kindLabel: GROUP_LABEL.inferred,
      code: task._code,
      title: `${task._route} · ${task._planDate || '无计划日期'}`,
      detail: `原记录无巡检班组，按路线归属推定「${task._crew}」${task._dateBackfilled ? '；计划日期由完成时间回填' : ''}`,
      date: task._planDate,
      sourceType: 'patrol',
      sourceCode: task._code,
      defaultAction: '班组归属核查',
    })
  }

  for (const hazard of hazards.filter((row) => !isBlank(row['来源巡检编号']))) {
    items.push({
      kind: 'hazard',
      kindLabel: GROUP_LABEL.hazard,
      code: String(hazard['隐患编号']),
      title: `${String(hazard['隐患部位'])}（${String(hazard['隐患等级'])}）`,
      detail: `巡检 ${String(hazard['来源巡检编号'])} 上报 ${String(hazard['上报问题数'] ?? 0)} 项，台账状态「${hazard.status}」`,
      date: String(hazard['发现日期'] ?? ''),
      sourceType: 'hazard',
      sourceCode: String(hazard['隐患编号']),
      defaultAction: '巡检问题整改',
    })
  }

  for (const doc of legacyDocs) {
    const paper = String(doc['来源形式']) === '纸面扫描'
    items.push({
      kind: 'legacy',
      kindLabel: GROUP_LABEL.legacy,
      code: String(doc['单据编号']),
      title: `${String(doc['计量点位'])} · 抄表周期 ${String(doc['抄表周期'])}`,
      detail: paper
        ? `早期仅有纸面单据，按扫描件编号 ${String(doc['扫描件编号'])} 建账`
        : '电子往期单据按抄表周期搬入建账',
      date: String(doc['建账日期'] ?? ''),
      sourceType: 'legacy',
      sourceCode: String(doc['单据编号']),
      defaultAction: '往期单据核对',
    })
  }

  for (const failure of failures) {
    items.push({
      kind: 'failure',
      kindLabel: GROUP_LABEL.failure,
      code: failure.已解决 ? `FAIL-${failure.id}-已解决` : `FAIL-${failure.id}`,
      title: failure.业务动作,
      detail: failure.原因 + (failure.已解决 ? `（已于 ${failure.解决时间} 重试成功）` : '（待重试）'),
      date: failure.时间.slice(0, 10),
      sourceType: 'failure',
      sourceCode: String(failure.id),
      defaultAction: '失败重试',
    })
  }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const kinds: KeyItemKind[] = ['duplicate', 'inferred', 'hazard', 'legacy', 'failure']
  const groups = kinds.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    count: items.filter((item) => item.kind === kind).length,
  }))

  return { items, groups, total: items.length }
}

export function monthIssueCount(tasks: GovernedPatrol[], anchor: Date = new Date()): number {
  const prefix = formatDateInput(anchor).slice(0, 7)
  return tasks
    .filter((task) => task._kept && task._planDate.startsWith(prefix))
    .reduce((sum, task) => sum + task._issues, 0)
}
