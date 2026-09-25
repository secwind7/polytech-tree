// 真实科技数据加载：data/*.json 为唯一事实源
// 字符串 id（era/category）映射为数字索引，供布局与渲染管线使用
import techsRaw from '../data/techs.json'
import erasRaw from '../data/eras.json'
import categoriesRaw from '../data/categories.json'

// ───── 原始 JSON 结构（调研产物的 schema） ─────
interface RawTech {
  id: string
  name: string
  nameEn: string
  wikiEn?: string
  aliases?: string[]
  year: number
  year_basis: string | null
  year_note: string
  kind: string
  era: string
  category: string
  importance: number
  prereqs: string[]
  related: string[]
  desc: string
}

interface RawEra {
  id: string
  name: string
  nameEn: string
  yearStart: number
  yearEnd: number
  order: number
}

interface RawCategory {
  id: string
  name: string
  nameEn: string
  color: string
  group: string            // 顶层域群 A 形式与符号 / B 认识自然 / C 改造世界 / D 人与社会
  subcategories: string[]
}

export const GROUP_NAMES: Record<string, string> = {
  A: '形式与符号', B: '认识自然', C: '改造世界', D: '人与社会',
}

const techs = techsRaw as RawTech[]
const eras = [...(erasRaw as RawEra[])].sort((a, b) => a.order - b.order)
const categories = categoriesRaw as RawCategory[]

// ───── 字符串 id → 数字索引 ─────
export const ERA_ID_TO_INDEX = new Map(eras.map((e, i) => [e.id, i]))
export const CATEGORY_ID_TO_INDEX = new Map(categories.map((c, i) => [c.id, i]))

/** 渲染管线使用的节点结构（era/category 已转为索引，name 已做缺失回退） */
export interface TechNode {
  id: string
  name: string          // 中文名，缺失时回退英文（不向玩家暴露内部 id）
  nameEn: string
  wikiEn: string        // 英文维基条目标题：desc 派生文字的署名对象（见 LICENSE-data.md §2）
  aliases: string[]     // 别名/曾用名（搜索定位用）
  year: number
  yearBasis: string     // 年代依据（规范 §6），exact 表示"批次给了确切年份"而非已逐条核对
  yearNote: string
  kind: string          // §3 副轴：原理/工艺/器物/制度/媒介
  era: number           // 时代层索引
  category: number      // 领域索引
  importance: number
  prereqs: string[]
  related: string[]
  desc: string
}

export const TECHS: TechNode[] = techs.map(t => ({
  id: t.id,
  name: t.name || t.nameEn, // 中文缺失回退英文
  nameEn: t.nameEn,
  wikiEn: t.wikiEn ?? '',
  aliases: t.aliases ?? [],
  year: t.year,
  yearBasis: t.year_basis ?? 'exact',
  yearNote: t.year_note ?? '',
  kind: t.kind ?? '',
  era: ERA_ID_TO_INDEX.get(t.era) ?? 0,
  category: CATEGORY_ID_TO_INDEX.get(t.category) ?? 0,
  importance: t.importance,
  prereqs: t.prereqs ?? [],
  related: t.related ?? [],
  desc: t.desc,
}))

export const TECH_BY_ID = new Map(TECHS.map(t => [t.id, t]))

// ───── `kind` 副轴（规范 §3）：不参与空间聚簇，用于筛选与文案 ─────
export const KIND_ORDER = ['原理', '工艺', '器物', '制度', '媒介']
export const KIND_COUNTS: Record<string, number> = KIND_ORDER.reduce(
  (acc, k) => (acc[k] = TECHS.filter(t => t.kind === k).length, acc), {} as Record<string, number>)

// ───── 年代依据标签（规范 §6：让"精确数值"与"真实精度"同时可见） ─────
export const YEAR_BASIS_LABEL: Record<string, { mark: string; approx: boolean }> = {
  exact: { mark: '', approx: false },
  batch_asserted: { mark: '批次给出，未逐条核对', approx: false },
  circa: { mark: '约数', approx: true },
  decade: { mark: '十年代取值', approx: true },
  century: { mark: '世纪中值', approx: true },
  range_midpoint: { mark: '文献区间中点', approx: true },
  scholarly_disputed: { mark: '学界有分歧，取主流值', approx: true },
  convention_floor: { mark: '仅知时代归属，取起点', approx: true },
}

// ───── 时代信息（供标签/字幕/悬浮使用） ─────
function yearLabel(y: number): string {
  if (y < 0) {
    const abs = Math.abs(y)
    return abs >= 10000 ? `前 ${(abs / 10000).toFixed(abs % 10000 === 0 ? 0 : 1)} 万` : `前 ${abs}`
  }
  return `${y}`
}

export const ERA_INFO: { id: string; name: string; range: string }[] = eras.map(e => ({
  id: e.id,
  name: e.name,
  range: `${yearLabel(e.yearStart)} – ${e.yearEnd >= 2025 ? '今' : yearLabel(e.yearEnd)}`,
}))

export const ERA_COUNT = eras.length

// ───── 领域信息（色值以数据为准，替代 scene.ts 硬编码） ─────
export const CATEGORY_GROUPS = categories.map(c => c.group)
export const CATEGORY_NAMES = categories.map(c => c.name)
export const CATEGORY_HEX = categories.map(c => c.color)
export const CATEGORY_COUNT = categories.length
