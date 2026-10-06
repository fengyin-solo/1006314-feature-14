// 纯前端没有后端推送：写操作落账后广播一次，其它页面（概览、排班、关键条目、派工）
// 切回来或正打开时收到事件统一重算，保证各处条数一起变、不出现两个数。
export const DATA_CHANGED_EVENT = 'urban-utility-tunnel:data-changed'

export function emitDataChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT))
  }
}

export function onDataChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  const listener = () => handler()
  window.addEventListener(DATA_CHANGED_EVENT, listener)
  return () => window.removeEventListener(DATA_CHANGED_EVENT, listener)
}
