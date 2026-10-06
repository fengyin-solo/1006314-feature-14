/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

// 治理层（派工/失败记录等）不是标准业务模块，行结构更宽，单独一个类型。
export type GenericRow = {
  [field: string]: unknown
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  // 治理口径：概览与看板共用，条数只能来自这里，避免出现两个数。
  patrol: { raw: number; kept: number; merged: number; inferred: number }
  keyItems: { total: number; groups: { label: string; count: number }[] }
  dayDistribution: { date: string; weekday: string; isToday: boolean; count: number }[]
}
