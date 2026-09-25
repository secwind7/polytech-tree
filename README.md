# Polytech Tree · 人类科技树 3D 可视化

[English](#english) · [中文](#中文)

---

## 中文

一座可以自由旋转的"科技之塔"：人类历史上的每一项科技都是一个多面体节点，按时代分层堆叠，按领域分扇区着色。

### 视觉编码

| 通道 | 含义 |
|---|---|
| 高度（Y 轴） | 时间。每个水平层是一个时代，从底部的史前到顶部的智能时代 |
| 角度（扇区） | 领域。每个时代内按"该领域在本层的科技数占比"分配扇区宽度；领域次序固定为 `categories.json` 的顺序，只有宽度逐层变化 |
| 颜色 | 领域，色值同样取自 `categories.json` |
| 面数 | 重要度：20 面 = 基石 → 12 领域支柱 → 8 领域内重要 → 6 改良与细分 → 4 长尾补充 |
| 尺寸 | 与重要度同向（`importanceScale()`） |
| 层半径 | 由"需求面积最大的扇区"决定（需求面积 ÷ 该扇区角度占比）。因为扇区宽度已按数量比例分配，各扇区密度接近一致 —— 实测扇区密度 max/min 从等角度时代的 47.7× 降到 2.3× |

### 交互

- 左键拖拽旋转 · 滚轮缩放 · 右键平移
- 悬停节点：中英文名、年份、时代、领域、重要度星级、前置科技、简介
- `Ctrl+F`：打开搜索框，按中英文名与别名匹配；回车或点选后相机平滑推近，把节点置于屏幕中心并高亮
- 空格：切换冻结/恢复（节点自转、相机自动旋转、漫游同时暂停）；冻结时信息卡固定且可点，便于打开卡里的英文维基条目链接
- `▶ 漫游动画`：画面只留时代名与科技名。相机沿中轴线上升、视线全程完全朝下（实测仰角恒 −90.00°），绕视轴以 1.72°/s 缓慢滚转；它固定领先正显现层 130 单位，**视场按"要看的圆盘"大小逐帧反推并渐变**（实测 45.6°~109.0°，每 0.25s 变化 ≤0.76°），所以小时代收得不广角、大时代自动拉宽，11/11 层的单帧可见覆盖 100%。实测无任何采样点出现"已显现节点高过摄像机"，即显现中的科技不会被遮挡，未到达时代的圆盘与时代名同时隐去。各时代按科技数分配 10~30 秒（全片约 3 分钟），时代内科技按 year 逐个显现（弹入冲到 2.5 倍并闪白 13×，0.5 秒后回落，名字停 2 秒）；连线从前置显现时起笔朝目标爬行（爬行压缩到 1.6 秒内完成，同时爬行的边从 973 降到 56），**抵达那一刻正好是目标科技显现的时刻**。Esc 或点击画面退出
- 图例中的滑块：控制在画面里显示多少个节点名称（按到相机的距离取最近 N 个）

### 快速开始

```bash
npm install
npm run dev        # 开发服务器
npm run build      # tsc 类型检查 + 打包到 dist/
npm run validate   # 校验 data/ 下的数据（见 CONTRIBUTING.md）
```

需要 Node.js 18+ 和 Python 3（仅 `validate` 用到）。

### 项目结构

```
data/
  techs.json       科技节点：唯一事实源
  eras.json        时代分层与年份区间
  categories.json  领域：颜色 / 多面体形状 / 子类
  core-ids.json    核心科技注册表（校验用的锚点）
  research/        分时代的调研记录（数据来源，供追溯）
src/
  data.ts          JSON → 渲染用节点（字符串 id 转索引）
  layout.ts        圆柱塔布局：时代分层 + 领域扇区 + 拥挤度扩散
  polyhedra.ts     按重要度实例化多面体（InstancedMesh）
  edges.ts         前置/关联连线 + 时代标记环
  labels.ts        节点名称与时代名的弧形实例化文字
  tour.ts          漫游排期：时代窗口时长 + 按 year 显现 + 中轴线俯视轨道
  controls.ts      相机：环绕观察 + 漫游轨道播放
  scene.ts         渲染器、光照、雾
scripts/
  validate_data.py    数据校验（CI 用，返回非零表示有错误）
  merge_research.py   research/ → techs.json 的合并
  recompute_era.py    按 year 重算 era
```

技术栈：TypeScript + [three.js](https://threejs.org/) + Vite。无后端、无运行时网络请求，全部数据在构建时打进包里。

### 许可

分两块，都已生效：代码（`src/`、`scripts/`）为 [MIT](LICENSE)；数据（`data/`）的结构化字段为
[CC BY 4.0](LICENSE-data.md)，而中文 `desc` 摘要里源自英文维基百科的部分继续按 **CC BY-SA 4.0**
提供并署名（英文维基是相同方式共享，翻译算衍生作品），每条对应的英文条目名见该条目的 `wikiEn`。

### 参与贡献

新增科技、时代、领域，请看 [CONTRIBUTING.md](CONTRIBUTING.md)。数据是普通 JSON，改完跑一次 `npm run validate` 即可提 PR。

---

## English

A freely rotatable "tower of technology": every technology humans ever invented is a polyhedron, stacked in era layers and split into domain sectors by angle.

- **Height = time.** Each horizontal layer is an era, from prehistory at the base to the intelligent age at the top.
- **Angle = domain.** One full circle divided by `data/categories.json`; color comes from the same file.
- **Face count = importance.** 20 faces for cornerstone technologies down to 4 for long-tail entries; node size follows the same scale.
- **Layer radius = density.** Eras with more recorded technologies bulge outward, which is why the modern section reads as an explosion.

Interactions: drag to orbit, wheel to zoom, right-drag to pan, hover a node for its card (bilingual name, year, era, domain, importance, prerequisites, summary), and press the tour button to fly the camera up through the eras.

Built with TypeScript, three.js and Vite. No backend and no runtime network calls — the dataset is bundled at build time, so the site is a set of static files.

The dataset lives in plain JSON files under `data/`, so adding a technology, an era or a domain is a pull request away. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Data provenance

Names, dates and article pointers were compiled from English Wikipedia (the `wikiEn` field records the article title an entry was checked against) plus period references; `data/research/` holds the per-era working notes behind every batch. Not every entry has a `wikiEn` yet — `npm run validate` lists the ones still missing it, so treat that field as an audit trail rather than a guarantee.

The `desc` summaries are meant to be original Chinese writing. An audit in 2026-09 found that a minority of entries sit close to the English lead they were checked against, so those summaries are treated as CC BY-SA-derived text rather than re-labelled as original (see the licence below); no per-entry rewrite pass is planned.

Treat the whole dataset as a curated educational index, not an authoritative chronology — dating the first instance of a technology is genuinely contested, and entries carry the year this compilation chose.

## License

Licensing is split in two, and both files are in effect:

* **Code** (`src/`, `scripts/`, build tooling): [MIT](LICENSE).
* **Data** (`data/`): structured fields (year, era, category, kind, importance, dependencies) under [CC BY 4.0](LICENSE-data.md); the Chinese `desc` summaries carry text derived from English Wikipedia and are therefore offered under **CC BY-SA 4.0** with attribution, since Wikipedia's licence is share-alike and translation counts as a derivative. `wikiEn` names the source article for each entry.

Reuse of the dataset means reading `LICENSE-data.md`: CC BY for the structure, CC BY-SA for the summaries.

