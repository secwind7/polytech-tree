// node scripts/prereq_focus_check.mjs (Node 22.18+)
import assert from 'node:assert/strict'
import { buildGraph, kHopDepth, prereqFocus } from '../src/graph.ts'

// Forks and a shared ancestor: upstream focus must exclude descendants and siblings.
const graph = buildGraph(
  ['root', 'left', 'right', 'target', 'sibling', 'child', 'isolated'],
  [[], ['root'], ['root'], ['left', 'right'], ['left'], ['target'], ['missing']]
)
const out = new Int8Array(graph.count)
assert.equal(prereqFocus(graph, 3, out), out)
assert.deepEqual([...out], [1, 1, 1, 0, -1, -1, -1])
// Existing undirected two-hop focus still includes descendants and siblings.
assert.deepEqual([...kHopDepth(graph, 3, 2, out)], [2, 1, 1, 0, 2, 1, -1])
prereqFocus(graph, 6, out)
assert.deepEqual([...out], [-1, -1, -1, -1, -1, -1, 0])

const cycle = buildGraph(['a', 'b', 'c'], [['c'], ['a'], ['b']])
assert.deepEqual([...prereqFocus(cycle, 0, new Int8Array(3))], [0, 1, 1])

// Int8 buffers are also used by the renderers: depth > 127 must stay in the focus set.
const ids = Array.from({ length: 260 }, (_, i) => String(i))
const chain = buildGraph(ids, ids.map((_, i) => i ? [ids[i - 1]] : []))
const full = prereqFocus(chain, 259, new Int8Array(260))
assert.equal(full[259], 0)
assert.ok(full.subarray(0, 259).every(value => value === 1))
console.log('OK: upstream-only focus, shared ancestors, isolated nodes, cycles, deep chains, and two-hop compatibility')
