import * as THREE from 'three'
import { geomRadius, type PlacedNode } from './layout'
import { FLASH } from './tour'

// 形状 = 重要度（面数越多越重要），颜色 = 领域（见 categories.json）
// 5 档重要度正好对应 5 种柏拉图立体的面数：20 / 12 / 8 / 6 / 4
// importance 1 = 基石 → 二十面体；importance 5 = 长尾 → 四面体
// 外接球半径由 layout.ts 的 geomRadius 统一给出，低面数立体因体积小而自然显得更小
const R = geomRadius(2) // 除基石外各档共用的外接球半径
const BY_IMPORTANCE: THREE.BufferGeometry[] = [
  new THREE.IcosahedronGeometry(geomRadius(1)), // 20 面 —— importance 1
  new THREE.DodecahedronGeometry(R),     // 12 面 —— importance 2
  new THREE.OctahedronGeometry(R),       //  8 面 —— importance 3
  new THREE.BoxGeometry(R * 2 / Math.sqrt(3), R * 2 / Math.sqrt(3), R * 2 / Math.sqrt(3)), // 6 面 —— 4
  new THREE.TetrahedronGeometry(R),      //  4 面 —— importance 5
]
const LEVELS = BY_IMPORTANCE.length

export function facesOf(importance: number): number {
  return [20, 12, 8, 6, 4][Math.min(LEVELS, Math.max(1, Math.round(importance))) - 1]
}

interface InstanceMeta {
  nodeIdx: number
  placed: PlacedNode
}

/**
 * 显现弹入曲线：前 22% 时长冲到 ~2 倍再落回 1 倍。
 * 漫游中节点在屏幕上只有几像素，靠这个尺寸冲击"闪白"才看得见。
 */
function pop(k: number): number {
  const grow = Math.min(1, k / 0.22)
  return grow * (1 + 1.6 * Math.pow(1 - k, 1.6))
}

export class PolyhedraField {
  meshes: THREE.InstancedMesh[] = []
  private metas: InstanceMeta[][] = []
  private highlightIdx: number | null = null
  private focusIdx: number | null = null
  private colors: THREE.Color[]
  private tmp = new THREE.Object3D()
  private white = new THREE.Color(0xffffff)
  // 筛选（§3 的 kind 副轴）：不改布局、不改尺寸，只把非匹配实例的颜色压向背景
  private keep: ((nodeIdx: number) => boolean) | null = null
  private byIdx: PlacedNode[]
  private dim = new THREE.Color(0x070a14)
  // 漫游显现：revealAt[节点] = 出现时刻，tourTime < 0 表示不在漫游中（全部可见）
  private revealAt: Float32Array | null = null
  private tourTime = -1
  private flashFlags: Uint8Array[] = []
  private tmpColor = new THREE.Color()

  constructor(placed: PlacedNode[], colors: THREE.Color[]) {
    this.colors = colors
    this.byIdx = placed
    const buckets: InstanceMeta[][] = Array.from({ length: LEVELS }, () => [])
    placed.forEach((p, globalIdx) => {
      const level = Math.min(LEVELS, Math.max(1, Math.round(p.node.importance))) - 1
      buckets[level].push({ nodeIdx: globalIdx, placed: p })
    })

    for (let lv = 0; lv < LEVELS; lv++) {
      const meta = buckets[lv]
      const mesh = new THREE.InstancedMesh(
        BY_IMPORTANCE[lv],
        new THREE.MeshStandardMaterial({ metalness: 0.15, roughness: 0.55 }),
        Math.max(1, meta.length)
      )
      mesh.count = meta.length
      mesh.frustumCulled = false // 实例分布全塔，禁用剔除避免误裁
      meta.forEach((m, i) => mesh.setColorAt(i, colors[m.placed.node.category]))
      this.meshes.push(mesh)
      this.metas.push(meta)
    }
  }

  /** 每帧更新自转；漫游中还要处理"按年份逐个显现 + 闪亮" */
  update(time: number) {
    const reveal = this.revealAt
    for (let lv = 0; lv < this.meshes.length; lv++) {
      const mesh = this.meshes[lv]
      const meta = this.metas[lv]
      const flags = reveal ? this.flashFlags[lv] : null
      let repaint = false
      for (let i = 0; i < meta.length; i++) {
        const p = meta[i].placed
        let s = p.scale
        let flash = 0
        if (reveal) {
          const age = this.tourTime - reveal[meta[i].nodeIdx]
          if (age < 0) s = 0
          else if (age < FLASH) {
            const k = age / FLASH
            s = p.scale * pop(k)
            flash = 1 - k
          }
        }
        this.tmp.position.copy(p.position)
        this.tmp.quaternion.setFromAxisAngle(p.spinAxis, p.phase + time * p.spinSpeed)
        this.tmp.scale.setScalar(s)
        this.tmp.updateMatrix()
        mesh.setMatrixAt(i, this.tmp.matrix)

        if (flags) {
          const was = flags[i] > 0
          if (flash > 0) {
            this.tmpColor.copy(this.colors[p.node.category]).multiplyScalar(1 + flash * 12)
            mesh.setColorAt(i, this.tmpColor)
            flags[i] = 1
            repaint = true
          } else {
            // 闪亮结束的那一帧把颜色写回基础色，其余帧不动这张 buffer
            if (was) { mesh.setColorAt(i, this.colors[p.node.category]); repaint = true }
            flags[i] = 0
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if (repaint && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** 进入漫游：接管可见性，节点按 revealAt 逐个出现 */
  beginTour(revealAt: Float32Array, t: number) {
    this.revealAt = revealAt
    this.tourTime = t
    this.flashFlags = this.metas.map(m => new Uint8Array(m.length))
  }

  /** 退出漫游：全部恢复可见并按当前筛选重绘 */
  endTour() {
    this.revealAt = null
    this.tourTime = -1
    this.flashFlags = []
    this.setFilter(this.keep)
  }

  setTourTime(t: number) {
    if (this.revealAt) this.tourTime = t
  }

  /** 设置/清除筛选（传 null 显示全部）；只改颜色，节点位置与大小不动 */
  setFilter(keep: ((nodeIdx: number) => boolean) | null) {
    this.keep = keep
    for (let lv = 0; lv < this.meshes.length; lv++) {
      const mesh = this.meshes[lv]
      this.metas[lv].forEach((m, i) => mesh.setColorAt(i, this.colorOf(m.nodeIdx)))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  private colorOf(nodeIdx: number): THREE.Color {
    const base = this.colors[this.byIdx[nodeIdx].node.category]
    if (this.highlightIdx === nodeIdx || this.focusIdx === nodeIdx) return this.white
    if (this.keep && !this.keep(nodeIdx)) return base.clone().lerp(this.dim, 0.9)
    return base
  }

  /** 悬停高亮：nodeIdx 为全局索引，null 恢复 */
  highlight(nodeIdx: number | null) {
    if (this.highlightIdx === nodeIdx) return
    const prev = this.highlightIdx
    this.highlightIdx = nodeIdx
    for (const idx of [prev, nodeIdx]) {
      if (idx !== null && idx !== undefined) this.repaint(idx)
    }
  }

  /** 搜索聚焦高亮：与悬停高亮互不干扰，悬停移开后仍保持 */
  setFocus(nodeIdx: number | null) {
    if (this.focusIdx === nodeIdx) return
    const prev = this.focusIdx
    this.focusIdx = nodeIdx
    for (const idx of [prev, nodeIdx]) {
      if (idx !== null && idx !== undefined) this.repaint(idx)
    }
  }

  private repaint(nodeIdx: number) {
    for (let lv = 0; lv < this.meshes.length; lv++) {
      const meta = this.metas[lv]
      for (let i = 0; i < meta.length; i++) {
        if (meta[i].nodeIdx !== nodeIdx) continue
        this.meshes[lv].setColorAt(i, this.colorOf(nodeIdx))
        if (this.meshes[lv].instanceColor) this.meshes[lv].instanceColor!.needsUpdate = true
        return
      }
    }
  }

  /** 根据射线命中的 mesh + instanceId 找回全局节点索引 */
  nodeIndexAt(mesh: THREE.Object3D, instanceId: number): number | null {
    const lv = this.meshes.indexOf(mesh as THREE.InstancedMesh)
    if (lv < 0 || instanceId >= this.metas[lv].length) return null
    return this.metas[lv][instanceId].nodeIdx
  }
}
