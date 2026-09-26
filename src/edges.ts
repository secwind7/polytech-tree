import * as THREE from 'three'
import type { PlacedNode } from './layout'
import { CATEGORY_COLORS } from './scene'
import { ERA_COUNT } from './data'

const SEG = 8 // 每条弧线的分段数
const GROW_MAX = 1.6 // 单条边可见爬行的最长时长（秒）

const VERT = `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aFocus;
varying vec3 vColor;
varying float vAlpha;
varying float vFocus;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vFocus = aFocus;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FRAG = `
uniform float uOpacity;
uniform float uFocusEnabled;
varying vec3 vColor;
varying float vAlpha;
varying float vFocus;
void main() {
  float a = vAlpha * uOpacity;
  vec3 color = vColor;
  if (uFocusEnabled > 0.5) {
    a *= mix(0.12, 2.6, vFocus);
    color = mix(vColor * 0.5, mix(vColor, vec3(1.0), 0.5), vFocus);
  }
  if (a <= 0.001) discard;
  gl_FragColor = vec4(color, min(a, 1.0));
}`

interface EdgeRec { start: number; dur: number; base: number }

/**
 * 真实依赖边：prereqs 中每条依赖连一条弧线（前置节点 → 当前节点），
 * 控制点向塔轴内收，颜色取目标节点（当前科技）的领域色。
 *
 * 漫游期间逐条生长：前置一显现就从它起笔，沿弧向目标延伸，抵达终点那一刻正好是目标
 * 科技显现的时刻 —— 故生长时长等于两端显现时刻之差。前置比目标更晚显现的"倒挂"边
 * 没有过程可言，在前置显现时整条点亮。
 */
export function buildEdges(placed: PlacedNode[], revealAt: Float32Array): {
  lines: THREE.LineSegments
  /** 环绕模式：突出悬停节点的直接前置边；无前置边时恢复普通显示 */
  highlightPrereqs: (nodeIdx: number | null) => void
  /** 锁定模式：突出目标及其所有上游节点的前置边 */
  highlightTree: (nodeIndices: readonly number[] | null) => void
  /** 进入漫游：线全部隐去，等待按显现时刻生长 */
  beginTour: () => void
  /** 漫游中每帧推进（t 为漫游时钟，单调） */
  update: (t: number) => void
  /** 退出漫游 / 环绕模式：恢复全部可见 */
  fillAll: () => void
} {
  const idxById = new Map(placed.map((p, i) => [p.node.id, i]))
  const byId = new Map(placed.map(p => [p.node.id, p]))

  const positions: number[] = []
  const colors: number[] = []
  const recs: EdgeRec[] = []
  const incomingByTarget: number[][] = Array.from({ length: placed.length }, () => [])
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3()
  const mid = new THREE.Vector3(), ctrl = new THREE.Vector3(), axisPt = new THREE.Vector3()
  const a = new THREE.Vector3(), b = new THREE.Vector3()

  for (const node of placed) {
    const targetIdx = idxById.get(node.node.id)!
    const arrive = revealAt[targetIdx]
    for (const prereqId of node.node.prereqs) {
      const from = byId.get(prereqId)
      if (!from) continue // 数据已验证无悬空，防御性跳过
      p0.copy(from.position)
      p1.copy(node.position)

      // 控制点：中点向塔轴内收
      mid.addVectors(p0, p1).multiplyScalar(0.5)
      axisPt.set(0, mid.y, 0)
      ctrl.copy(axisPt).sub(mid)
      const bend = Math.min(8, p0.distanceTo(p1) * 0.12)
      ctrl.normalize().multiplyScalar(bend).add(mid)

      const c = CATEGORY_COLORS[node.node.category].clone().multiplyScalar(0.5)
      // 每条弧按 t 递增写入 8 段 → 缓冲顺序即"前置→当前"的生长顺序
      const base = positions.length / 3
      for (let s = 0; s < SEG; s++) {
        const t0 = s / SEG, t1 = (s + 1) / SEG
        quadBezier(a, p0, ctrl, p1, t0)
        quadBezier(b, p0, ctrl, p1, t1)
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
      // 抵达时刻固定为目标节点的显现时刻；爬行过程压缩到 GROW_MAX 内 ——
      // 实测前置→目标的间隔中位 13s、p90 55s，照原样爬肉眼看不出在动
      const span = Math.max(0, Math.min(arrive - revealAt[idxById.get(prereqId)!], GROW_MAX))
      recs.push({ start: arrive - span, dur: span, base })
      incomingByTarget[targetIdx].push(recs.length - 1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
  const alpha = new Float32Array(positions.length / 3).fill(1)
  const alphaAttr = new THREE.BufferAttribute(alpha, 1)
  geo.setAttribute('aAlpha', alphaAttr)
  const focus = new Float32Array(alpha.length)
  const focusAttr = new THREE.BufferAttribute(focus, 1)
  geo.setAttribute('aFocus', focusAttr)

  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.3 }, uFocusEnabled: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(geo, material)

  let focusedEdges = new Set<number>()
  let lastHoverTarget: number | null | undefined
  const highlightTargets = (targets: readonly number[], locked = false) => {
    const next = new Set<number>()
    for (const target of targets) {
      for (const edge of incomingByTarget[target] ?? []) next.add(edge)
    }
    let dirty = false
    for (const edge of focusedEdges) {
      if (next.has(edge)) continue
      const base = recs[edge].base
      focus.fill(0, base, base + SEG * 2)
      dirty = true
    }
    for (const edge of next) {
      if (focusedEdges.has(edge)) continue
      const base = recs[edge].base
      focus.fill(1, base, base + SEG * 2)
      dirty = true
    }
    focusedEdges = next
    if (dirty) focusAttr.needsUpdate = true
    material.uniforms.uFocusEnabled.value = locked || next.size > 0 ? 1 : 0
  }

  // 0 = 未起笔，1 = 延伸中，2 = 已抵达。漫游时钟单调，故不需要回退
  const state = new Uint8Array(recs.length).fill(2)

  const writeEdge = (e: number, p: number) => {
    const base = recs[e].base
    for (let k = 0; k < SEG; k++) {
      const v = Math.min(1, Math.max(0, p * SEG - k))
      alpha[base + k * 2] = v
      alpha[base + k * 2 + 1] = v
    }
  }

  const setAll = (v: number, st: number) => {
    alpha.fill(v)
    state.fill(st)
    alphaAttr.needsUpdate = true
  }

  return {
    lines,
    highlightPrereqs: (nodeIdx: number | null) => {
      if (nodeIdx === lastHoverTarget) return
      lastHoverTarget = nodeIdx
      highlightTargets(nodeIdx === null ? [] : [nodeIdx])
    },
    highlightTree: (nodeIndices: readonly number[] | null) => {
      lastHoverTarget = undefined
      highlightTargets(nodeIndices ?? [], nodeIndices !== null)
    },
    beginTour: () => setAll(0, 0),
    update: (t: number) => {
      let dirty = false
      for (let e = 0; e < recs.length; e++) {
        if (state[e] === 2) continue
        const { start, dur } = recs[e]
        if (t < start) continue
        const p = dur <= 0 ? 1 : Math.min(1, (t - start) / dur)
        writeEdge(e, p)
        state[e] = p >= 1 ? 2 : 1
        dirty = true
      }
      if (dirty) alphaAttr.needsUpdate = true
    },
    fillAll: () => setAll(1, 2),
  }
}

function quadBezier(out: THREE.Vector3, p0: THREE.Vector3, c: THREE.Vector3, p1: THREE.Vector3, t: number) {
  const it = 1 - t
  out.set(
    it * it * p0.x + 2 * it * t * c.x + t * t * p1.x,
    it * it * p0.y + 2 * it * t * c.y + t * t * p1.y,
    it * it * p0.z + 2 * it * t * c.z + t * t * p1.z,
  )
}

/** 每个时代层的标记环 + 时代名锚点 */
export function buildEraRings(eraRadii: number[], eraY: number[]): { rings: THREE.Object3D[]; anchors: { era: number; pos: THREE.Vector3 }[] } {
  const rings: THREE.Object3D[] = []
  const anchors: { era: number; pos: THREE.Vector3 }[] = []
  const labelAngle = Math.PI * 0.25 // 朝向初始相机方向

  for (let e = 0; e < ERA_COUNT; e++) {
    const y = eraY[e]
    const r = eraRadii[e] + 2.5
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r))
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x3a4a7a, transparent: true, opacity: 0.4,
    }))
    rings.push(ring)
    anchors.push({ era: e, pos: new THREE.Vector3(Math.cos(labelAngle) * (r + 4), y + 1.5, Math.sin(labelAngle) * (r + 4)) })
  }
  return { rings, anchors }
}
