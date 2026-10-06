import type { EntryRow } from '@/data/types'
import { addDays, appendTrail, toCount, type CanonicalPatrol } from './patrol-domain'

// 隐患整改台账与派工清单的对账域：巡检上报的问题数在这里同步成隐患条目并挂待整改。
// 幂等键：隐患编号（=巡检编号-序号）。同一巡检同一序号，无论动作触发多少回，只落一条。

export function syncedHazardNo(patrolNo: string, seq: number): string {
  return `HAZA-XJ-${patrolNo}-${String(seq).padStart(2, '0')}`
}

export function dispatchNoOf(seq: number): string {
  return `DISP-${String(seq).padStart(4, '0')}`
}

export function hazardLevel(count: number, seq: number): string {
  // 每条隐患默认一般；当该次上报问题 ≥3 项时，第 1 条提级为重大，突出重点。
  if (count >= 3 && seq === 1) return '重大'
  return '一般'
}

function routePart(route: string): string {
  return route.length > 12 ? route.slice(0, 12) : route
}

type ReconcileResult = {
  hazards: EntryRow[]
  dispatches: EntryRow[]
  createdHazards: number
  createdDispatches: number
}

// 以规范化巡检为准，把每条「已上报」巡检的问题数展开为隐患条目，再与存量台账合并。
// 已存在的同步条目只回挂处理意见/派工状态，绝不覆盖用户已经做出的整改结论。
export function reconcileLedgers(
  patrols: CanonicalPatrol[],
  existingHazards: EntryRow[],
  existingDispatches: EntryRow[],
): ReconcileResult {
  const hazards = existingHazards.map((row) => ({ ...row }))
  const dispatches = existingDispatches.map((row) => ({ ...row }))
  const hazardById = new Map(hazards.map((row) => [String(row['隐患编号']), row]))
  const dispatchByHazard = new Map(dispatches.map((row) => [String(row['隐患编号']), row]))

  let createdHazards = 0
  let createdDispatches = 0
  let manualMax = 0
  for (const hz of hazards) {
    const no = String(hz['隐患编号'])
    if (/^HAZA-\d{4}-\d{4}$/.test(no)) {
      manualMax = Math.max(manualMax, Number(no.slice(-4)))
    }
  }
  let dispatchSeq = dispatches.reduce((max, row) => {
    const m = /^DISP-(\d+)$/.exec(String(row['派工编号'] ?? ''))
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  const ensureDispatch = (hz: EntryRow, sourcePatrolNo: string): EntryRow => {
    let disp = dispatchByHazard.get(String(hz['隐患编号']))
    if (!disp) {
      dispatchSeq += 1
      const no = dispatchNoOf(dispatchSeq)
      disp = {
        id: dispatchSeq,
        status: '待派工',
        pending: true,
        abnormal: false,
        派工编号: no,
        隐患编号: hz['隐患编号'],
        来源巡检编号: sourcePatrolNo,
        隐患部位: hz['隐患部位'],
        整改班组: '巡检整改班',
        派工日期: String(hz['发现日期']),
        整改期限: hz['整改期限'],
        派工状态: '待派工',
        处理意见: '',
      }
      dispatches.push(disp)
      dispatchByHazard.set(String(hz['隐患编号']), disp)
      createdDispatches += 1
    }
    return disp
  }

  for (const patrol of patrols) {
    if (String(patrol.status) !== '已上报') continue
    const count = toCount(patrol['发现问题数'])
    const patrolNo = String(patrol['巡检编号'])
    const route = String(patrol['巡检路线'])
    for (let seq = 1; seq <= count; seq += 1) {
      const no = syncedHazardNo(patrolNo, seq)
      let hz = hazardById.get(no)
      if (!hz) {
        manualMax += 1
        hz = {
          id: 10000 + manualMax,
          status: '待整改',
          pending: true,
          abnormal: false,
          隐患编号: no,
          隐患部位: `${routePart(route)}·巡检发现${seq}`,
          隐患等级: hazardLevel(count, seq),
          整改措施: '按巡检上报问题现场核查并整改',
          责任人员: '',
          发现日期: String(patrol['计划日期']),
          整改期限: addDays(String(patrol['计划日期']), 7),
          整改状态: '待整改',
          来源巡检编号: patrolNo,
          派工编号: '',
          处理意见: '',
        }
        hazards.push(hz)
        hazardById.set(no, hz)
        createdHazards += 1
      }
      hz['来源巡检编号'] = patrolNo
      const disp = ensureDispatch(hz, patrolNo)
      if (!hz['派工编号']) hz['派工编号'] = disp['派工编号']
      // 处理意见两边同源：任一侧写入都会在 saveOpinion 时同步，这里兜底回挂。
      if (disp['处理意见'] && !hz['处理意见']) hz['处理意见'] = disp['处理意见']
    }
  }

  // 手工台账隐患也必须有对应派工单。
  for (const hz of hazards) {
    if (!hz['来源巡检编号']) {
      const disp = ensureDispatch(hz, '')
      if (!hz['派工编号']) hz['派工编号'] = disp['派工编号']
      if (disp['处理意见'] && !hz['处理意见']) hz['处理意见'] = disp['处理意见']
    }
  }

  return { hazards, dispatches, createdHazards, createdDispatches }
}

// 保存处理意见：隐患台账与派工清单两边写同一份，其他入口取到的永远是一致内容。
export function saveOpinion(hazards: EntryRow[], dispatches: EntryRow[], hazardNo: string, opinion: string) {
  const nextHazards = hazards.map((row) =>
    String(row['隐患编号']) === hazardNo ? { ...row, 处理意见: opinion } : row,
  )
  const nextDispatches = dispatches.map((row) =>
    String(row['隐患编号']) === hazardNo
      ? { ...row, 处理意见: opinion, 操作轨迹: appendTrail(String(row['操作轨迹'] ?? ''), `回写处理意见：${opinion || '清空'}`) }
      : row,
  )
  return { hazards: nextHazards, dispatches: nextDispatches }
}

// 派工/隐患状态联动：以隐患编号为锚点，改任一边，另一边跟着变，保证两处同一份结论。
export function syncStatusByHazard(hazards: EntryRow[], dispatches: EntryRow[], hazardNo: string, status: string) {
  const stampLine = `状态联动为「${status}」`
  const nextHazards = hazards.map((row) =>
    String(row['隐患编号']) === hazardNo
      ? { ...row, status, 整改状态: status, pending: status !== '已验收', 操作轨迹: appendTrail(String(row['操作轨迹'] ?? ''), stampLine) }
      : row,
  )
  const nextDispatches = dispatches.map((row) =>
    String(row['隐患编号']) === hazardNo
      ? { ...row, status, 派工状态: status, pending: status !== '已验收', 操作轨迹: appendTrail(String(row['操作轨迹'] ?? ''), stampLine) }
      : row,
  )
  return { hazards: nextHazards, dispatches: nextDispatches }
}
