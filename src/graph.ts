// 依赖图：两跳关联与完整前置树聚焦共用的图结构。
// 只走画面上真实存在的弧线（prereqs），related 字段一条线都没画，参与高亮会自相矛盾。
// 索引空间与 layout.placed 一致，不引 three、不读 JSON，便于用 node 直接跑断言。

export interface DepGraph {
  count: number
  /** 与弧线一一对应：from = 前置、to = 依赖方 */
  edges: { from: number; to: number }[]
  /** 无向邻接：双向可达才叫"连线的另一端" */
  adj: number[][]
}

/** ids 为节点主键顺序，prereqs[i] 是 ids[i] 的前置主键列表 */
export function buildGraph(ids: string[], prereqs: string[][]): DepGraph {
  const idxById = new Map(ids.map((id, i) => [id, i]))
  const adj: number[][] = ids.map(() => [])
  const edges: { from: number; to: number }[] = []
  prereqs.forEach((list, to) => {
    for (const pid of list) {
      const from = idxById.get(pid)
      if (from === undefined) continue // 数据已验证无悬空，防御性跳过
      edges.push({ from, to })
      adj[from].push(to)
      adj[to].push(from)
    }
  })
  return { count: ids.length, edges, adj }
}

export const NOT_RELATED = -1

/** 完整上游前置集：0 = 自身、1 = 任意层前置、-1 = 集外（不是跳数，深链不会溢出）。 */
export function prereqFocus(g: DepGraph, start: number, out: Int8Array): Int8Array {
  const incoming: number[][] = Array.from({ length: g.count }, () => [])
  for (const { from, to } of g.edges) incoming[to].push(from)
  out.fill(NOT_RELATED)
  out[start] = 0
  const pending = [start]
  while (pending.length) {
    for (const from of incoming[pending.pop()!]) {
      if (out[from] !== NOT_RELATED) continue
      out[from] = 1
      pending.push(from)
    }
  }
  return out
}

/**
 * 从 start 沿连线走 maxHops 步，写入 out 并返回：0 = 自身、1..maxHops = 跳数、
 * NOT_RELATED = 不相干。out 由调用方复用（每次点击重新分配会掉帧）。
 */
export function kHopDepth(
  g: DepGraph, start: number, maxHops: number, out: Int8Array
): Int8Array {
  out.fill(NOT_RELATED)
  out[start] = 0
  let frontier: number[] = [start]
  for (let h = 1; h <= maxHops && frontier.length > 0; h++) {
    const next: number[] = []
    for (const cur of frontier) {
      for (const nb of g.adj[cur]) {
        if (out[nb] !== NOT_RELATED) continue
        out[nb] = h
        next.push(nb)
      }
    }
    frontier = next
  }
  return out
}
