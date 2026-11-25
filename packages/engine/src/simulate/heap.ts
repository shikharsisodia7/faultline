/**
 * Binary min-heap ordered by (time, seq). `seq` is a monotonically increasing
 * insertion counter, so events scheduled for the same instant are always
 * processed in the order they were scheduled: a total, deterministic order.
 */
export interface Scheduled {
  t: number
  seq: number
}

export class EventHeap<T extends Scheduled> {
  private items: T[] = []

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    const a = this.items
    a.push(item)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(a[i], a[p])) {
        ;[a[i], a[p]] = [a[p], a[i]]
        i = p
      } else break
    }
  }

  pop(): T | undefined {
    const a = this.items
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && less(a[l], a[m])) m = l
        if (r < a.length && less(a[r], a[m])) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m], a[i]]
        i = m
      }
    }
    return top
  }

  peek(): T | undefined {
    return this.items[0]
  }
}

function less(a: Scheduled, b: Scheduled): boolean {
  return a.t < b.t || (a.t === b.t && a.seq < b.seq)
}
