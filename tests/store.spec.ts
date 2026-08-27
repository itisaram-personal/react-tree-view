/* Dependency-free assertions for the flat model and the store. Run: npm test */
import { buildModel } from '../src/model'
import { TreeStore } from '../src/store'
import type { TreeNodeSource } from '../src/types'

let failures = 0
let checks = 0

function ok(condition: boolean, message: string): void {
  checks++
  if (!condition) {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  checks++
  if (a !== b) {
    failures++
    console.error(`  ✗ ${message}\n      expected ${b}\n      actual   ${a}`)
  }
}

function group(name: string, fn: () => void): void {
  console.log(name)
  fn()
}

const sample: TreeNodeSource[] = [
  {
    id: 'a',
    children: [
      { id: 'a1', children: [{ id: 'a1a' }, { id: 'a1b' }] },
      { id: 'a2', children: [{ id: 'a2a' }] },
    ],
  },
  { id: 'b' },
]

group('model', () => {
  const model = buildModel(sample)
  eq(model.size, 7, 'node count')
  eq(Array.from(model.ids), ['a', 'a1', 'a1a', 'a1b', 'a2', 'a2a', 'b'], 'depth-first order')
  eq(Array.from(model.depth), [0, 1, 2, 2, 1, 2, 0], 'depth per node')
  eq(Array.from(model.descendants), [5, 2, 0, 0, 1, 0, 0], 'descendant counts')
  eq(model.maxDepth, 2, 'max depth')
  const childrenOfA = []
  for (let k = model.childStart[0]; k < model.childStart[1]; k++) {
    childrenOfA.push(model.ids[model.childIndex[k]])
  }
  eq(childrenOfA, ['a1', 'a2'], 'CSR children of a')
})

group('tri-state checks', () => {
  const store = new TreeStore(sample)
  const at = (id: string) => store.indexOf(id)
  const state = (id: string) => store.checkState[at(id)]

  store.setSubtreeCheck(at('a1a'), 1)
  eq([state('a1a'), state('a1'), state('a')], [1, 2, 2], 'one leaf makes ancestors indeterminate')

  store.setSubtreeCheck(at('a1b'), 1)
  eq([state('a1'), state('a')], [1, 2], 'all children checked promotes the parent')

  store.setSubtreeCheck(at('a2'), 1)
  eq([state('a2a'), state('a')], [1, 1], 'deep check fills the subtree and the root')

  store.setSubtreeCheck(at('a1a'), 0)
  eq([state('a1'), state('a')], [2, 2], 'unchecking one leaf demotes every ancestor')

  eq(store.getCheckedIds({ mode: 'leaves' }), ['a1b', 'a2a'], 'checked leaves')
  eq(store.getCheckedIds({ mode: 'shallow' }), ['a1b', 'a2'], 'topmost fully checked nodes')
  eq(
    store.getCheckedIds({ mode: 'all', includeIndeterminate: true }),
    ['a', 'a1', 'a1b', 'a2', 'a2a'],
    'checked plus indeterminate',
  )

  store.setSubtreeCheck(at('a'), 0)
  eq(store.getCheckedIds(), [], 'deep uncheck clears everything')

  store.setAllChecked(1)
  eq(store.getCheckedIds({ mode: 'shallow' }), ['a', 'b'], 'checkAll rolls up to the roots')
})

group('disabled branches', () => {
  const withDisabled: TreeNodeSource[] = [
    {
      id: 'a',
      children: [
        { id: 'a1', children: [{ id: 'a1a' }, { id: 'a1b' }] },
        { id: 'a2', disabled: true, children: [{ id: 'a2a' }] },
      ],
    },
  ]
  const store = new TreeStore(withDisabled)
  store.setSubtreeCheck(store.indexOf('a'), 1)
  eq(store.checkState[store.indexOf('a2a')], 0, 'disabled subtree is skipped')
  eq(store.checkState[store.indexOf('a')], 2, 'skipping keeps the parent indeterminate')
  eq(store.getCheckedIds({ mode: 'leaves' }), ['a1a', 'a1b'], 'only enabled leaves are checked')
})

group('expansion and virtual rows', () => {
  const store = new TreeStore(sample)
  store.ensureVisible()
  eq(store.visibleCount, 2, 'collapsed tree shows the roots only')

  store.setExpanded(store.indexOf('a'), true)
  store.ensureVisible()
  eq(store.visibleCount, 4, 'expanding a root reveals its direct children')

  store.setExpanded(store.indexOf('a'), true, true)
  store.ensureVisible()
  eq(store.visibleCount, 7, 'deep expand reveals the whole subtree')
  eq(store.visibleIndexOf(store.indexOf('a2a')), 5, 'row lookup of a deep node')

  store.setExpanded(store.indexOf('a1'), false, true)
  store.ensureVisible()
  eq(store.visibleCount, 5, 'deep collapse hides the branch')
  eq(store.visibleIndexOf(store.indexOf('a1a')), -1, 'hidden nodes report no row')

  store.setAllExpanded(false)
  store.reveal(store.indexOf('a2a'))
  store.ensureVisible()
  eq(store.visibleIndexOf(store.indexOf('a2a')) >= 0, true, 'reveal opens every ancestor')

  store.expandToLevel(0)
  store.ensureVisible()
  eq(store.visibleCount, 4, 'expandToLevel(0) shows roots and their children')
})

group('filtering', () => {
  const rows = (store: TreeStore) => {
    store.ensureVisible()
    return Array.from(store.visible.slice(0, store.visibleCount), (i) => store.model.ids[i])
  }

  const store = new TreeStore(sample)
  const only = (id: string) => store.setFilter((node) => node.id === id)

  only('a1b')
  eq(store.matchCount, 1, 'one node matched')
  // a is the ancestor, a1 the parent, a1b the match. a2/a2a/b are gone, and so
  // is a1a — a sibling of the match is not part of its path.
  eq(rows(store), ['a', 'a1', 'a1b'], 'the match and its ancestors, opened all the way down')
  eq(store.isMatch(store.indexOf('a1b')), true, 'the match is flagged')
  eq(store.isMatch(store.indexOf('a1')), false, 'an ancestor kept for context is not a match')

  // A fresh store, since the filter above left `a1` open behind it.
  const branch = new TreeStore(sample)
  branch.setFilter((node) => node.id === 'a1')
  eq(rows(branch), ['a', 'a1'], 'a matching branch itself starts collapsed')
  branch.setExpanded(branch.indexOf('a1'), true)
  eq(rows(branch), ['a', 'a1', 'a1a', 'a1b'], 'and opens to show everything under it')

  store.setFilter((node) => String(node.id).startsWith('a2'))
  eq(rows(store), ['a', 'a2', 'a2a'], 'a matching child is opened down to, not collapsed away')
  eq(store.matchCount, 2, 'both a2 and a2a matched')

  store.setFilter(() => false)
  eq(rows(store), [], 'a filter nothing matches empties the tree')
  eq(store.filtered, true, 'and it is still a filter')

  store.setSubtreeCheck(store.indexOf('a2a'), 1)
  store.setFilter(null)
  eq(store.filtered, false, 'cleared')
  eq(rows(store).length, 7, 'every row comes back, since the filter opened the tree')
  eq(store.checkState[store.indexOf('a2a')], 1, 'check state set under a filter survives it')
  eq(store.matchCount, 0, 'no matches without a filter')
})

group('state survives a data swap', () => {
  const store = new TreeStore(sample)
  store.setSubtreeCheck(store.indexOf('a1'), 1)
  store.setExpanded(store.indexOf('a'), true)

  const grown: TreeNodeSource[] = [
    {
      id: 'a',
      children: [
        { id: 'a1', children: [{ id: 'a1a' }, { id: 'a1b' }, { id: 'a1c' }] },
        { id: 'a2', children: [{ id: 'a2a' }] },
      ],
    },
    { id: 'b' },
  ]
  const next = new TreeStore(grown, {}, store)
  eq(next.checkState[next.indexOf('a1a')], 1, 'leaf check carried over')
  eq(next.checkState[next.indexOf('a1c')], 0, 'new leaf starts unchecked')
  eq(next.checkState[next.indexOf('a1')], 2, 'parent re-derived after the new child arrived')
  eq(next.expanded[next.indexOf('a')], 1, 'expansion carried over')
})

group('independent selection', () => {
  const store = new TreeStore(sample, { selectionMode: 'independent' })
  const at = (id: string) => store.indexOf(id)
  const state = (id: string) => store.checkState[at(id)]
  const inside = (id: string) => store.selectedInside[at(id)]

  store.setSubtreeCheck(at('a1'), 1, false)
  eq(
    [state('a1'), state('a1a'), state('a1b')],
    [1, 0, 0],
    'checking a node leaves its children alone',
  )
  eq(state('a'), 0, 'the parent is not derived from its children')
  eq([inside('a'), inside('a1')], [1, 0], 'the selection is counted on the ancestors')

  store.setSubtreeCheck(at('a1a'), 1, false)
  eq([inside('a'), inside('a1')], [2, 1], 'a deeper selection bumps every ancestor')

  store.setSubtreeCheck(at('a1'), 0, false)
  eq([state('a1'), state('a1a')], [0, 1], 'unchecking a node leaves its children alone')
  eq([inside('a'), inside('a1')], [1, 1], 'only the unchecked node leaves the counts')

  store.setSubtreeCheck(at('a'), 1, true)
  eq(
    store.getCheckedIds(),
    ['a', 'a1', 'a1a', 'a1b', 'a2', 'a2a'],
    'an explicit deep check marks every node in the subtree',
  )
  eq([inside('a'), inside('a2')], [5, 1], 'counts cover every level')
  eq(state('a'), 1, 'the node itself is checked, not derived')

  store.setSubtreeCheck(at('a'), 0, true)
  eq(
    [store.getCheckedIds(), inside('a')],
    [[], 0],
    'deep uncheck clears the subtree and the counts',
  )

  store.setAllChecked(1)
  eq(inside('a'), 5, 'checkAll rebuilds the counts')
  eq(store.checkState[at('b')], 1, 'leaf roots are checked too')
})

group('badge counts in cascade mode', () => {
  const store = new TreeStore(sample)
  store.setSubtreeCheck(store.indexOf('a1'), 1)
  eq(store.selectedInside[store.indexOf('a')], 3, 'a1 plus its two leaves are counted on a')
  store.setSubtreeCheck(store.indexOf('a1a'), 0)
  eq(
    store.selectedInside[store.indexOf('a')],
    1,
    'demoting a1 to indeterminate drops it from the count',
  )
})

group('switching selection mode', () => {
  const cascade = new TreeStore(sample)
  cascade.setSubtreeCheck(cascade.indexOf('a1'), 1)
  eq(cascade.checkState[cascade.indexOf('a')], 2, 'cascade leaves the root indeterminate')

  const independent = new TreeStore(sample, { selectionMode: 'independent' }, cascade)
  eq(
    independent.getCheckedIds(),
    ['a1', 'a1a', 'a1b'],
    'explicitly checked nodes carry over, the indeterminate root does not',
  )
  eq(independent.selectedInside[independent.indexOf('a')], 3, 'counts are rebuilt after the switch')

  const back = new TreeStore(sample, {}, independent)
  eq(back.checkState[back.indexOf('a1')], 1, 'a1 is checked again because both leaves are')
  eq(back.checkState[back.indexOf('a')], 2, 'and the root goes back to indeterminate')
})

group('default check depth follows the mode', () => {
  // What `api.check(id)` with no options does: TreeView passes `store.cascades`
  // as the default, so one menu item works correctly in both modes.
  const cascade = new TreeStore(sample)
  cascade.setSubtreeCheck(cascade.indexOf('a1'), 1, cascade.cascades)
  eq(cascade.getCheckedIds(), ['a1', 'a1a', 'a1b'], 'cascade selects the node and its subtree')

  const independent = new TreeStore(sample, { selectionMode: 'independent' })
  independent.setSubtreeCheck(independent.indexOf('a1'), 1, independent.cascades)
  eq(independent.getCheckedIds(), ['a1'], 'independent selects only the node itself')
  eq(independent.selectedInside[independent.indexOf('a')], 1, 'and the ancestor badge counts it')
})

group('selecting the sub level of a node', () => {
  // What the "Select sub level" menu item does: every direct child, at the
  // depth the current selection mode implies.
  const childrenOfA = (store: TreeStore) => {
    const m = store.model
    const a = store.indexOf('a')
    const out: number[] = []
    for (let k = m.childStart[a]; k < m.childStart[a + 1]; k++) out.push(m.childIndex[k])
    return out
  }

  const cascade = new TreeStore(sample)
  for (const child of childrenOfA(cascade)) cascade.setSubtreeCheck(child, 1, cascade.cascades)
  eq(
    cascade.getCheckedIds(),
    ['a', 'a1', 'a1a', 'a1b', 'a2', 'a2a'],
    'cascade fills each child subtree, and the parent rolls up',
  )

  const independent = new TreeStore(sample, { selectionMode: 'independent' })
  for (const child of childrenOfA(independent)) {
    independent.setSubtreeCheck(child, 1, independent.cascades)
  }
  eq(independent.getCheckedIds(), ['a1', 'a2'], 'independent marks only the direct children')
  eq(independent.checkState[independent.indexOf('a')], 0, 'the node itself stays unselected')
  eq(independent.selectedInside[independent.indexOf('a')], 2, 'its badge shows the two children')
})

group('invariants under random operations', () => {
  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x2f6e2b1
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const build = (level: number, path: string): TreeNodeSource => {
    const node: TreeNodeSource = { id: path, disabled: level > 0 && rand() < 0.07 }
    if (level < 4) {
      node.children = []
      const count = 1 + Math.floor(rand() * 4)
      for (let i = 0; i < count; i++) node.children.push(build(level + 1, `${path}.${i}`))
    }
    return node
  }
  const roots = [build(0, 'r0'), build(0, 'r1')]

  for (const mode of ['cascade', 'independent'] as const) {
    const store = new TreeStore(roots, { selectionMode: mode })
    const m = store.model

    for (let step = 0; step < 4000; step++) {
      const index = Math.floor(rand() * m.size)
      const roll = rand()
      if (roll < 0.45) store.setSubtreeCheck(index, 1, rand() < 0.5)
      else if (roll < 0.9) store.setSubtreeCheck(index, 0, rand() < 0.5)
      else if (roll < 0.95) store.setAllChecked(1)
      else store.setAllChecked(0)
    }

    // Recompute everything from scratch and compare with the incremental state.
    let badgeDrift = 0
    let stateDrift = 0
    let disabledTouched = 0
    for (let i = 0; i < m.size; i++) {
      let expected = 0
      for (let j = i + 1; j <= i + m.descendants[i]; j++) {
        if (store.checkState[j] === 1) expected++
      }
      if (store.selectedInside[i] !== expected) badgeDrift++

      if (mode === 'cascade' && store.childCount(i) > 0) {
        let checked = 0
        let partial = 0
        for (let k = m.childStart[i]; k < m.childStart[i + 1]; k++) {
          const state = store.checkState[m.childIndex[k]]
          if (state === 1) checked++
          else if (state === 2) partial++
        }
        const derived = checked === store.childCount(i) ? 1 : checked === 0 && partial === 0 ? 0 : 2
        if (store.checkState[i] !== derived) stateDrift++
      }
      // A disabled node is never set directly. In cascade mode a disabled
      // *parent* still summarises its children, which stay individually usable.
      const derivedOnly = mode === 'cascade' && store.childCount(i) > 0
      if (m.disabled[i] === 1 && !derivedOnly && store.checkState[i] !== 0) disabledTouched++
    }

    eq(badgeDrift, 0, `${mode}: selected-inside counts match a full recount`)
    eq(stateDrift, 0, `${mode}: every parent matches its derived state`)
    eq(disabledTouched, 0, `${mode}: disabled nodes were never set directly`)
  }
})

group('scale', () => {
  // 6 levels x 7 children ≈ 137k nodes.
  const build = (level: number, path: string): TreeNodeSource => {
    const node: TreeNodeSource = { id: path }
    if (level < 6) {
      node.children = []
      for (let i = 0; i < 7; i++) node.children.push(build(level + 1, `${path}.${i}`))
    }
    return node
  }
  const roots = [build(0, 'r0')]

  let started = performance.now()
  const store = new TreeStore(roots, { expandAll: true })
  const buildMs = performance.now() - started
  ok(store.model.size > 130_000, `built ${store.model.size.toLocaleString()} nodes`)

  started = performance.now()
  store.ensureVisible()
  const visibleMs = performance.now() - started

  started = performance.now()
  store.setSubtreeCheck(0, 1)
  const checkMs = performance.now() - started

  started = performance.now()
  const ids = store.getCheckedIds({ mode: 'leaves' })
  const collectMs = performance.now() - started

  // One pass to test, one up, one down — over 137k nodes.
  started = performance.now()
  store.setFilter((node) => String(node.id).endsWith('.6'))
  const filterMs = performance.now() - started
  store.ensureVisible()
  ok(store.matchCount > 19_000, `filter matched ${store.matchCount.toLocaleString()} nodes`)
  ok(store.visibleCount < store.model.size, 'and the row list shrank')
  ok(filterMs < 100, `filtering the whole tree took ${filterMs.toFixed(1)} ms`)
  store.setFilter(null)
  store.ensureVisible()
  eq(store.visibleCount, store.model.size, 'clearing brings every row back')

  eq(store.checkState[0], 1, 'root ends up fully checked')
  eq(ids.length, Math.pow(7, 6), 'every leaf is checked')
  ok(checkMs < 100, `deep check of the whole tree took ${checkMs.toFixed(1)} ms`)
  console.log(
    `  build ${buildMs.toFixed(1)} ms · visible rows ${visibleMs.toFixed(1)} ms · ` +
      `deep check ${checkMs.toFixed(1)} ms · collect ${collectMs.toFixed(1)} ms · ` +
      `filter ${filterMs.toFixed(1)} ms`,
  )
})

console.log(`\n${checks - failures}/${checks} assertions passed`)
if (failures > 0) process.exit(1)
