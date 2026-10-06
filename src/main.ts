import './style.css'
import * as THREE from 'three'
import { TECHS, TECH_BY_ID, ERA_INFO, ERA_COUNT, CATEGORY_NAMES, CATEGORY_COUNT, CATEGORY_HEX, CATEGORY_GROUPS, GROUP_NAMES, YEAR_BASIS_LABEL } from './data'
import type { TechNode } from './data'
import { layoutTower } from './layout'
import { createScene } from './scene'
import { PolyhedraField, facesOf } from './polyhedra'
import { buildEdges, buildEraRings } from './edges'
import { buildNameLabels, buildEraLabels, updateLabelFocal, setLabelMinPxAll } from './labels'
import { CameraRig } from './controls'
import { TourPlan, BLEND } from './tour'
import { buildGraph, kHopDepth, prereqFocus } from './graph'

// ───── 数据与布局 ─────
const { placed, eraRadii, eraY, towerHeight } = layoutTower(TECHS)

// 点击聚焦沿"画面上真实存在的弧线"走 2 跳：实测集大小 p50 10 / p90 39 / max 184，
// 规模压得住，故不设限流（校验见 scripts/focus_graph_check.mjs）
const graph = buildGraph(placed.map(p => p.node.id), placed.map(p => p.node.prereqs))
const FOCUS_HOPS = 2

// 统计行随数据变化，避免写死后再也数不清
document.getElementById('statLine')!.textContent =
  `${TECHS.length} 项科技 · ${ERA_COUNT} 个时代 · ${CATEGORY_COUNT} 大领域`

// ───── 场景 ─────
const { scene, camera, renderer } = createScene(towerHeight, eraRadii)

const field = new PolyhedraField(
  placed,
  CATEGORY_HEX.map(h => new THREE.Color(h))
)
field.meshes.forEach(m => scene.add(m))

const { rings } = buildEraRings(eraRadii, eraY)
rings.forEach(r => scene.add(r))

const nameLabels = buildNameLabels(placed)
nameLabels.meshes.forEach(m => scene.add(m))

// 时代名标签：每个时代名拆成单字，沿该层圆环外沿固定方位弧形排布
const eraLabels = buildEraLabels(eraRadii, eraY)
eraLabels.meshes.forEach(m => scene.add(m))

// ───── 相机与漫游排期 ─────
const plan = new TourPlan(placed, eraRadii, eraY)
const rig = new CameraRig(camera, renderer.domElement, eraRadii, towerHeight, plan)

// 连线要在漫游中按显现时刻生长，故依赖 plan 的 revealAt
const edges = buildEdges(placed, plan.revealAt)
scene.add(edges.lines)

// ───── UI：图例（领域可隐藏）+ 名称显示上限 ─────
const legend = document.getElementById('legend')!
const catCount = CATEGORY_NAMES.map((_, i) => placed.filter(p => p.node.category === i).length)
const IMPLbl = ['基石', '领域支柱', '领域内重要', '改良与细分', '长尾补充']
legend.innerHTML = `
  <div class="lg-head"><div class="lg-title">领域图例</div>
    <button class="lg-toggle" id="legendToggle" title="折叠/展开图例">▾</button></div>
  <div class="lg-body">
  ${['A', 'B', 'C', 'D'].map(g => `
    <button class="lg-group" data-group="${g}" title="整组开关：组内有隐藏时全显，否则全隐">${GROUP_NAMES[g]}<i>▾</i></button>
    ${CATEGORY_NAMES.map((name, i) => CATEGORY_GROUPS[i] === g ? `
      <button class="lg-item lg-cat" data-cat="${i}" title="点击隐藏该领域（含其连线），再点恢复">
        <span class="lg-dot" style="background:${CATEGORY_HEX[i]};color:${CATEGORY_HEX[i]}"></span><span>${name}</span><b>${catCount[i]}</b>
      </button>` : '').join('')}`).join('')}
  <div class="lg-hint">点领域名隐藏该领域（含连线）· 点组名整组开关</div>
  <button class="lg-reset" id="catReset">全部显示</button>
  <div class="lg-sep"></div>
  <div class="lg-title">形状 = 重要度（面数）</div>
  ${[1, 2, 3, 4, 5].map(l => `
    <button class="lg-item lg-imp" data-level="${l}" title="点击只看该档（独显），再点恢复全部">
      <span>${facesOf(l)} 面 ${IMPLbl[l - 1]}</span><b>${placed.filter(p => p.node.importance === l).length}</b>
    </button>`).join('')}
  <div class="lg-hint">点一档 = 只看这一档；再点恢复</div>
  <div class="lg-sep"></div>
  <div class="lg-title">名称显示上限</div>
  <div class="lg-limit">
    <input type="range" id="labelLimitRange" min="0" max="${TECHS.length}" step="1" value="100">
    <span id="labelLimitValue">100</span>
  </div>
  <div class="lg-hint">按到相机距离显示最近的名称</div>
  <div class="lg-sep"></div>
  <div class="lg-title">副轴 kind（规范 §3：筛选与文案）</div>
  <div class="lg-kinds" id="kindFilter"></div>
  <div class="lg-hint">点选即筛选：隐去节点、连线与名称，不动位置</div>
  </div>
`
// 图例折叠：只留标题行，把画面让给塔身
const legendToggle = document.getElementById('legendToggle') as HTMLButtonElement
legendToggle.addEventListener('click', () => {
  const collapsed = legend.classList.toggle('collapsed')
  legendToggle.textContent = collapsed ? '▸' : '▾'
})

// ───── 可见性状态：领域掩码 ∧ kind 掩码 ∧ 重要度独显 + 点击聚焦，三处渲染共用一次下发 ─────
const hiddenCats = new Set<number>()
const activeKinds = new Set<string>()
let soloImp: number | null = null // 独显某档重要度（null = 不限档）
let selected: number | null = null
let selectionMode: 'nearby' | 'prereqs' = 'nearby'
const focusBuf = new Int8Array(placed.length)
let focusDepth: Int8Array | null = null
const nodeVis = new Uint8Array(placed.length).fill(1) // 1 = 在场（未被隐藏）
const edgeActive = new Uint8Array(placed.length).fill(1) // 在场且在聚焦集内 → 连线遮罩
const isVisible = (i: number) => nodeVis[i] > 0

const kindFilter = document.getElementById('kindFilter')!
const KINDS = ['原理', '工艺', '器物', '制度', '媒介'] as const
kindFilter.innerHTML = KINDS.map((k, i) =>
  `<button class="lg-kind" data-kind="${k}">${k}<b>${placed.filter(p => p.node.kind === k).length}</b></button>`).join('')

// 域群 → 该组下的领域索引。键必须是 categories.json 的组字母（A/B/C/D），
// 图例的 data-group 用的就是这个字母
const CATS_BY_GROUP: Record<string, number[]> = Object.fromEntries(
  ['A', 'B', 'C', 'D'].map(g =>
    [g, CATEGORY_NAMES.map((_, i) => i).filter(i => CATEGORY_GROUPS[i] === g)]))

function syncPanelState() {
  legend.querySelectorAll('.lg-cat').forEach(el =>
    el.classList.toggle('off', hiddenCats.has(Number((el as HTMLElement).dataset.cat))))
  // 组头三态：全隐 / 部分隐 / 全显，免得整组灰着却看不出组里还剩几个领域
  legend.querySelectorAll('.lg-group').forEach(el => {
    const cats = CATS_BY_GROUP[(el as HTMLElement).dataset.group!] ?? []
    const hidden = cats.filter(c => hiddenCats.has(c)).length
    el.classList.toggle('off', hidden === cats.length)
    el.classList.toggle('part', hidden > 0 && hidden < cats.length)
  })
  document.getElementById('catReset')!.classList.toggle('idle', hiddenCats.size === 0 && soloImp === null)
  legend.querySelectorAll('.lg-imp').forEach(el =>
    el.classList.toggle('on', Number((el as HTMLElement).dataset.level) === soloImp))
  kindFilter.querySelectorAll('.lg-kind').forEach(el =>
    el.classList.toggle('on', activeKinds.has((el as HTMLElement).dataset.kind!)))
}

function applyVisualState() {
  const kindsOn = activeKinds.size > 0
  for (let i = 0; i < placed.length; i++) {
    const n = placed[i].node
    nodeVis[i] = !hiddenCats.has(n.category) &&
      (!kindsOn || activeKinds.has(n.kind)) &&
      (soloImp === null || n.importance === soloImp) ? 1 : 0
  }
  // 选中项所属领域被隐藏时聚焦自动失效
  if (selected !== null && !nodeVis[selected]) { selected = null; focusDepth = null }
  for (let i = 0; i < placed.length; i++)
    edgeActive[i] = nodeVis[i] && (!focusDepth || focusDepth[i] >= 0) ? 1 : 0
  syncPanelState()
  field.setVisible(isVisible, focusDepth)
  nameLabels.setFilter(isVisible)
  nameLabels.setFocus(focusDepth)
  edges.setActive(edgeActive)
  edges.setEmphasis(focusDepth !== null) // 聚焦时子图的线提亮
  if (focusDepth) edges.highlightPrereqs(null)
}

legend.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest?.('.lg-cat, .lg-group, .lg-imp, .lg-reset') as HTMLElement | null
  if (!el) return
  if (el.classList.contains('lg-reset')) { hiddenCats.clear(); soloImp = null }
  else if (el.classList.contains('lg-imp')) {
    const l = Number(el.dataset.level)
    soloImp = soloImp === l ? null : l // 独显：再点同一档即恢复
  } else if (el.classList.contains('lg-group')) {
    const cats = CATS_BY_GROUP[el.dataset.group!] ?? []
    const anyHidden = cats.some(c => hiddenCats.has(c))
    for (const c of cats) anyHidden ? hiddenCats.delete(c) : hiddenCats.add(c)
  } else {
    const c = Number(el.dataset.cat)
    hiddenCats.has(c) ? hiddenCats.delete(c) : hiddenCats.add(c)
  }
  applyVisualState()
})

kindFilter.addEventListener('click', e => {
  const k = (e.target as HTMLElement)?.dataset?.kind
  if (!k) return
  activeKinds.has(k) ? activeKinds.delete(k) : activeKinds.add(k)
  applyVisualState()
})

let labelLimit = 100
const limitRange = document.getElementById('labelLimitRange') as HTMLInputElement
const limitValue = document.getElementById('labelLimitValue')!
limitRange.addEventListener('input', () => {
  labelLimit = Number(limitRange.value)
  limitValue.textContent = String(labelLimit)
})

// ───── UI：字幕 ─────
const caption = document.getElementById('eraCaption')!
let captionTimer = 0
rig.onEraChange = era => {
  const info = ERA_INFO[era]
  const win = plan.windows[era]
  caption.innerHTML = `${info.name}<span class="sub">${info.range} · ${win.count} 项</span>`
  caption.classList.add('show')
  clearTimeout(captionTimer)
  // 只停留到本时代窗口过半，把画面让给正在显现的科技名
  captionTimer = window.setTimeout(() => caption.classList.remove('show'), win.dur * 450)
}

// ───── UI：工具栏 ─────
const btnTour = document.getElementById('btnTour') as HTMLButtonElement
const btnReset = document.getElementById('btnReset') as HTMLButtonElement

// 漫游期间只保留时代名与科技名：其余界面与悬停让位，连线改为按显现时刻生长
const BASE_FOV = camera.fov
const fog = scene.fog as THREE.Fog
const FOG_BASE = { near: fog.near, far: fog.far }
let shownEra = -2
let shownFov = BASE_FOV

// 视场随"要看的圆盘"渐变；标签的像素换算依赖焦距，改 fov 必须同步
function applyFov(fov: number) {
  if (Math.abs(fov - shownFov) < 0.05) return
  shownFov = fov
  camera.fov = fov
  camera.updateProjectionMatrix()
  updateLabelFocal(innerHeight, fov)
}

// 未到达时代的圆盘与时代名不显示：俯视时它们是画面上方那片空白里唯一的杂物
function showEraStage(era: number) {
  if (era === shownEra) return
  shownEra = era
  rings.forEach((r, i) => (r.visible = i <= era))
  eraLabels.setVisibleThrough(era)
}

function setTouring(on: boolean) {
  document.body.classList.toggle('touring', on)
  if (!on) applyFov(BASE_FOV) // 环绕模式恢复默认视场；漫游中由主循环逐帧驱动
  setLabelMinPxAll(on ? 18 : 0) // 漫游中远处的名字也要读得清
  // 俯视会看到下方整棵已积累的树，把雾推远免得它糊成一片背景
  fog.near = on ? 420 : FOG_BASE.near
  fog.far = on ? 2200 : FOG_BASE.far
  if (on) {
    hoverIdx = null
    shownEra = -2
    // 漫游是纯观赏：聚焦先解除，领域/kind 的隐藏保留（连线遮罩与隐去一并带上）
    selected = null
    focusDepth = null
    applyVisualState()
    field.beginTour(plan.revealAt, 0)
    edges.beginTour()
  } else {
    tooltip.classList.remove('show')
    renderer.domElement.style.cursor = ''
    field.endTour()
    field.highlight(null)
    edges.fillAll()
    nameLabels.invalidate()
    showEraStage(ERA_COUNT - 1)
  }
}

btnTour.addEventListener('click', () => {
  if (rig.mode === 'tour') {
    rig.stopTour()
  } else {
    rig.startTour()
    setTouring(true)
    btnTour.textContent = '⏹ 停止漫游'
    btnTour.classList.add('active')
  }
})
btnReset.addEventListener('click', () => rig.resetView())
rig.onTourEnd = () => {
  clearTimeout(captionTimer)
  caption.classList.remove('show')
  setTouring(false)
  btnTour.textContent = '▶ 漫游动画'
  btnTour.classList.remove('active')
}

// ───── 拾取：悬停看信息，点击锁定关联 ─────
const tooltip = document.getElementById('tooltip')!
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
let hoverIdx: number | null = null

// 规范 §6：tooltip 同时显示"精确数值"与"真实精度"，避免把约定值读成确证
function yearText(n: TechNode): string {
  const b = YEAR_BASIS_LABEL[n.yearBasis] ?? { mark: '', approx: false }
  const abs = Math.abs(n.year)
  const core = n.year >= 0
    ? `${n.year} 年`
    : abs >= 10000 ? `前 ${(abs / 10000).toFixed(abs % 10000 === 0 ? 0 : 1)} 万年` : `公元前 ${abs} 年`
  return `${b.approx ? '约' : ''}${core}${b.mark ? `（${b.mark}）` : ''}`
}

function pickAt(clientX: number, clientY: number): number | null {
  const rect = renderer.domElement.getBoundingClientRect()
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(ndc, camera)
  // 隐去的节点由 field 挡回 null，但要继续试更靠后的命中，否则它们会挡住身后
  for (const h of raycaster.intersectObjects(field.meshes, false)) {
    const idx = field.nodeIndexAt(h.object, h.instanceId!)
    if (idx !== null) return idx
  }
  return null
}

function selectNode(idx: number | null, mode: 'nearby' | 'prereqs' = 'nearby') {
  if (idx === null || (idx === selected && mode === selectionMode)) {
    selected = null
    focusDepth = null
  } else {
    selected = idx
    selectionMode = mode
    focusDepth = mode === 'prereqs'
      ? prereqFocus(graph, idx, focusBuf)
      : kHopDepth(graph, idx, FOCUS_HOPS, focusBuf)
  }
  applyVisualState()
}

renderer.domElement.addEventListener('pointermove', e => {
  if (rig.mode === 'tour') return // 漫游中相机在动，悬停无意义
  const idx = pickAt(e.clientX, e.clientY)
  hoverIdx = idx
  if (idx === null) {
    tooltip.classList.remove('show')
    renderer.domElement.style.cursor = ''
    return
  }
  const n = placed[idx].node
  // 前置科技：显示名称（最多 4 个，避免溢出）
  const prereqNames = n.prereqs
    .map(id => TECH_BY_ID.get(id)?.name ?? '')
    .filter(Boolean)
    .slice(0, 4)
    .join('、')
  const link = selected === null ? '' : selected === idx
    ? `<div class="tt-dim">已聚焦：${selectionMode === 'prereqs' ? '全部上游前置科技' : '与其相连的两跳内科技'}</div>`
    : focusDepth && focusDepth[idx] >= 0
      ? `<div class="tt-dim">${selectionMode === 'prereqs' ? '属于上游前置树' : `在聚焦范围内（${focusDepth[idx]} 跳）`}</div>` : ''
  tooltip.innerHTML = `
    <div class="tt-name">${n.name}</div>
    <div class="tt-dim">${n.nameEn !== n.name ? n.nameEn + ' · ' : ''}${yearText(n)}</div>
    <div class="tt-dim">${ERA_INFO[n.era].name} · ${CATEGORY_NAMES[n.category]}${n.kind ? ' · ' + n.kind : ''}</div>
    <div class="tt-dim">重要度 ${'★'.repeat(6 - n.importance)}${'☆'.repeat(n.importance - 1)}　${facesOf(n.importance)} 面</div>
    ${prereqNames ? `<div class="tt-dim">前置：${prereqNames}</div>` : ''}
    ${n.desc ? `<div class="tt-desc">${n.desc}</div>` : ''}
    ${link}
    ${n.wikiEn
      ? `<div class="tt-src">摘要参考英文维基百科条目
          <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(n.wikiEn)}" target="_blank" rel="noopener">${n.wikiEn}</a>
          （CC BY-SA 4.0）</div>`
      : ''}
  `
  tooltip.style.left = `${e.clientX + 16}px`
  tooltip.style.top = `${e.clientY + 12}px`
  tooltip.classList.add('show')
  renderer.domElement.style.cursor = 'pointer'
})

renderer.domElement.addEventListener('pointerleave', () => {
  hoverIdx = null
  tooltip.classList.remove('show')
  renderer.domElement.style.cursor = ''
})

// 普通点击保留两跳聚焦，Shift + 点击锁定完整前置树；拖动与退出漫游不触发选择。
let pointerDown: { x: number; y: number; time: number; id: number; wasTouring: boolean } | null = null
renderer.domElement.addEventListener('pointerdown', e => {
  pointerDown = e.button === 0
    ? { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId, wasTouring: rig.mode === 'tour' }
    : null
}, true)
renderer.domElement.addEventListener('pointerup', e => {
  const down = pointerDown
  pointerDown = null
  if (!down || down.id !== e.pointerId || down.wasTouring || e.button !== 0 || rig.mode === 'tour') return
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
  if (performance.now() - down.time > 400) return
  selectNode(pickAt(e.clientX, e.clientY), e.shiftKey ? 'prereqs' : 'nearby')
})
renderer.domElement.addEventListener('pointercancel', () => { pointerDown = null })
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected !== null) selectNode(null)
})

// ───── 自适应窗口 ─────
function refreshView() {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  updateLabelFocal(innerHeight, camera.fov) // 标签屏幕最小像素换算依赖焦距
}
refreshView()
window.addEventListener('resize', refreshView)

// ───── 主循环 ─────
const clock = new THREE.Clock()
const nameIdx = new Int32Array(placed.length)
const nameAlpha = new Float32Array(placed.length)

// 首帧前把掩码下发一遍：面板初始态（"全部显示"是否可点）也在这里对齐
applyVisualState()

function loop() {
  requestAnimationFrame(loop)
  const dt = Math.min(clock.getDelta(), 0.1)
  const time = clock.elapsedTime

  rig.update(dt)
  if (rig.mode === 'tour') {
    const t = rig.tourT - BLEND
    applyFov(plan.fovAt(t))
    field.setTourTime(t)
    field.update(time)
    edges.update(t)
    showEraStage(plan.eraOf(t))
    nameLabels.setTourNames(Math.max(0, plan.collectNames(t, nameIdx, nameAlpha)), nameIdx, nameAlpha)
  } else {
    field.update(time)
    field.highlight(hoverIdx)
    edges.highlightPrereqs(selected === null ? hoverIdx : null)
    // 名称：仅完整在屏内的，按距离保留最近 limit 个
    nameLabels.update(camera, labelLimit, innerWidth, innerHeight)
  }
  eraLabels.update() // 时代名位置固定，无需每帧更新（保留接口兼容）

  renderer.render(scene, camera)
}
loop()
