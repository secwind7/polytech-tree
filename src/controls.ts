import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { startViewDistance } from './layout'
import { BLEND, type TourPlan } from './tour'

// 相机系统：环绕观察（默认）+ 螺旋上升漫游动画（轨道与排期见 tour.ts）
export type CameraMode = 'orbit' | 'tour'

const WORLD_UP = new THREE.Vector3(0, 1, 0)

export class CameraRig {
  mode: CameraMode = 'orbit'
  /** 漫游时钟（秒）：orbit 模式下无意义 */
  tourT = 0
  controls: OrbitControls
  onEraChange?: (era: number) => void
  onTourEnd?: () => void

  private camera: THREE.PerspectiveCamera
  private plan: TourPlan
  private eraRadii: number[]
  private towerHeight: number
  private lastEra = -1
  private startPos = new THREE.Vector3()
  private startTarget = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()
  private pos = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)
  // 搜索聚焦动画：从当前位姿平滑移到目标节点正前方
  private focusing = false
  private focusT = 0
  private focusDur = 1.1
  private focusFromPos = new THREE.Vector3()
  private focusFromTarget = new THREE.Vector3()
  private focusToPos = new THREE.Vector3()
  private focusToTarget = new THREE.Vector3()
  // 冻结（空格开关）：相机与节点全停，方便把鼠标移到信息卡上点链接
  private frozen = false
  private autoRotateBeforeFreeze = false

  constructor(
    camera: THREE.PerspectiveCamera, dom: HTMLElement,
    eraRadii: number[], towerHeight: number, plan: TourPlan
  ) {
    this.camera = camera
    this.plan = plan
    this.eraRadii = eraRadii
    this.towerHeight = towerHeight

    this.controls = new OrbitControls(camera, dom)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.35
    this.controls.maxDistance = 950
    this.controls.minDistance = 6
    this.controls.target.set(0, this.towerHeight * 0.5, 0)

    // 用户一旦交互就停掉自动旋转
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false })

    // ESC 中断漫游
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.mode === 'tour') this.stopTour()
    })
    // 点击画布中断漫游 / 聚焦动画
    dom.addEventListener('pointerdown', () => {
      if (this.mode === 'tour') this.stopTour()
      if (this.focusing) this.cancelFocus()
    })
  }

  resetView() {
    this.stopTour()
    this.controls.target.set(0, this.towerHeight * 0.5, 0)
    const d = startViewDistance(this.eraRadii, this.towerHeight) / Math.SQRT2
    this.camera.position.set(d, this.towerHeight * 0.68, d)
    this.controls.autoRotate = true
    this.controls.update()
  }

  startTour() {
    if (this.mode === 'tour') return
    this.mode = 'tour'
    this.tourT = 0
    this.lastEra = -1
    this.plan.reset()
    this.startPos.copy(this.camera.position)
    this.startTarget.copy(this.controls.target)
    this.controls.enabled = false
  }

  stopTour() {
    if (this.mode !== 'tour') return
    this.mode = 'orbit'
    this.controls.enabled = true
    // 漫游把 up 改成了水平向量（视线朝上时必需），环绕模式要交还世界竖直
    this.camera.up.copy(WORLD_UP)
    this.controls.target.copy(this.lookTarget.lengthSq() > 0 ? this.lookTarget : new THREE.Vector3(0, this.camera.position.y, 0))
    this.controls.update()
    this.onTourEnd?.()
  }

  /** 冻结/解冻（空格切换）：冻结时暂停相机运动（自动旋转、漫游、聚焦动画） */
  setFrozen(frozen: boolean) {
    if (this.frozen === frozen) return
    this.frozen = frozen
    if (frozen) {
      this.autoRotateBeforeFreeze = this.controls.autoRotate
      this.controls.autoRotate = false
    } else {
      this.controls.autoRotate = this.autoRotateBeforeFreeze
    }
  }

  /** 搜索聚焦：把相机平滑移到目标节点正前方，节点位于屏幕中心 */
  focusOn(position: THREE.Vector3, distance: number) {
    this.stopTour()
    this.controls.autoRotate = false
    // 沿当前视线方向靠近：方向不变，只平移 + 收拢，视觉上最自然
    const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position)
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.35, 1).normalize()
    else dir.normalize()
    this.focusFromPos.copy(this.camera.position)
    this.focusFromTarget.copy(this.controls.target)
    this.focusToTarget.copy(position)
    this.focusToPos.copy(position).addScaledVector(dir, -distance)
    this.focusT = 0
    this.focusing = true
    this.controls.enabled = false
  }

  /** 用户开始拖拽时立即结束聚焦动画，落到目标位姿 */
  private cancelFocus() {
    if (!this.focusing) return
    this.focusing = false
    this.camera.position.copy(this.focusToPos)
    this.controls.target.copy(this.focusToTarget)
    this.camera.lookAt(this.controls.target)
    this.controls.enabled = true
    this.controls.update()
  }

  private updateFocus(dt: number) {
    this.focusT += dt / this.focusDur
    const k = Math.min(1, this.focusT)
    const s = k * k * (3 - 2 * k) // smoothstep
    this.camera.position.lerpVectors(this.focusFromPos, this.focusToPos, s)
    this.controls.target.lerpVectors(this.focusFromTarget, this.focusToTarget, s)
    this.camera.lookAt(this.controls.target)
    if (k >= 1) {
      this.focusing = false
      this.controls.enabled = true
      this.controls.update()
    }
  }

  update(dt: number) {
    if (this.frozen) return
    if (this.focusing) {
      this.updateFocus(dt)
      return
    }
    if (this.mode === 'orbit') {
      this.controls.update()
      return
    }

    this.tourT += dt
    if (this.tourT >= this.plan.total) {
      this.applyTourPose(this.plan.total)
      this.stopTour()
      return
    }
    this.applyTourPose(this.tourT)
  }

  private applyTourPose(t: number) {
    this.plan.poseAt(t, this.pos, this.lookTarget)
    this.plan.upAt(t, this.up)

    // 开场从当前位姿融入中轴线起点
    if (t < BLEND) {
      const k = t / BLEND
      const s = k * k * (3 - 2 * k) // smoothstep
      this.pos.lerpVectors(this.startPos, this.pos, s)
      this.lookTarget.lerpVectors(this.startTarget, this.lookTarget, s)
      this.up.lerpVectors(WORLD_UP, this.up, s)
    }

    this.camera.position.copy(this.pos)
    this.camera.up.copy(this.up)
    this.camera.lookAt(this.lookTarget)

    const era = this.plan.eraOf(t)
    if (era !== this.lastEra) {
      this.lastEra = era
      this.onEraChange?.(era)
    }
  }
}
