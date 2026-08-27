/* Render smoke test: proves the component produces rows, markup and aria state. */
import { renderToString } from 'react-dom/server'
import { TreeView } from '../src/TreeView'
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

// useLayoutEffect has no meaning during renderToString; the warning is noise here.
const warn = console.error
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect')) return
  warn(...args)
}

/** Matches the class on an element, not the `.MuiCheckbox-indeterminate` selector
 *  inside the emotion <style> blocks MUI ships with its SSR output. */
const hasIndeterminateBox = (html: string) => /[\s"]MuiCheckbox-indeterminate[\s"]/.test(html)

const data: TreeNodeSource[] = [
  {
    id: 'root',
    label: 'root',
    children: Array.from({ length: 40 }, (_, i) => ({
      id: `child-${i}`,
      label: `child ${i}`,
      children: [{ id: `leaf-${i}`, label: `leaf ${i}` }],
    })),
  },
]

console.log('render')

const html = renderToString(
  <TreeView
    data={data}
    defaultExpandAll
    rowHeight={28}
    overscan={4}
    renderTrailing={(meta) => <span className="count">{meta.descendantCount}</span>}
  />,
)

const rows = html.match(/data-trt-index/g)?.length ?? 0
ok(rows > 10, `virtualized window rendered ${rows} rows, not all 81 nodes`)
ok(rows < 81, 'virtualization keeps the DOM well below the node count')
ok(html.includes('role="tree"'), 'container carries role=tree')
ok(html.includes('role="treeitem"'), 'rows carry role=treeitem')
ok(html.includes('aria-expanded="true"'), 'expanded rows expose aria-expanded')
ok(html.includes('aria-level="3"'), 'depth is exposed through aria-level')
ok(html.includes('MuiCheckbox-root'), 'MUI checkboxes render')
ok(html.includes('data-trt-action="expand-deep"'), 'deep expand button renders')
ok(html.includes('data-trt-action="collapse-deep"'), 'deep collapse button renders')
ok(html.includes('class="count"'), 'custom trailing renderer runs')
ok(html.includes('child 0'), 'labels render')

const independent = renderToString(
  <TreeView
    data={data}
    selectionMode="independent"
    defaultCheckedIds={['child-0', 'leaf-0', 'leaf-1']}
    defaultExpandAll
  />,
)
ok(independent.includes('3 selected inside'), 'root shows the badge for all three selections')
ok(independent.includes('1 selected inside'), 'child-0 shows the badge for its own leaf')
ok(!hasIndeterminateBox(independent), 'independent mode never renders an indeterminate box')
ok(
  (independent.match(/Mui-checked/g)?.length ?? 0) >= 3,
  'explicitly checked nodes render as checked',
)

const cascade = renderToString(
  <TreeView data={data} defaultCheckedIds={['leaf-0']} defaultExpandAll />,
)
ok(hasIndeterminateBox(cascade), 'cascade mode still rolls parents up to indeterminate')
ok(!cascade.includes('selected inside'), 'and shows no badge by default')

// A submenu of every child, the way the demo builds "Select a sub level".
const withMenu = renderToString(
  <TreeView
    data={data}
    defaultExpandAll
    contextMenu={({ nodeId, api }) => [
      {
        id: 'sub',
        label: 'Select a sub level',
        disabled: ({ meta }) => !meta.hasChildren,
        submenu: () =>
          api.getChildIds(nodeId).map((childId) => ({
            id: String(childId),
            label: String(childId),
            onSelect: () => api.check(childId),
          })),
      },
    ]}
  />,
)
ok(withMenu.includes('data-trt-index'), 'a tree with a submenu-bearing menu still renders')

const collapsed = renderToString(<TreeView data={data} />)
ok((collapsed.match(/data-trt-index/g)?.length ?? 0) === 1, 'collapsed tree renders one row')

// Wrapping labels: rows carry a floor, not a height, and nothing scrolls sideways.
ok(html.includes('--trt-row-h:28px'), 'the row height is published as a CSS variable')
ok(/class="trt-row"[^>]*style="min-height:28px/.test(html), 'wrapped rows get a min-height')
ok(!html.includes('trt-root--nowrap'), 'wrapping is the default')

const nowrap = renderToString(<TreeView data={data} wrapLabels={false} defaultExpandAll />)
ok(nowrap.includes('trt-root--nowrap'), 'wrapLabels={false} marks the root')
ok(/class="trt-row"[^>]*style="height:28px/.test(nowrap), 'uniform rows get a fixed height')
// Uniform rows are pure arithmetic: row n sits at n * rowHeight.
ok(nowrap.includes('translateY(28px)'), 'uniform rows are positioned by index * rowHeight')

// Filtering: only the matches and their paths reach the DOM. "child 3" matches
// child-3 and child-30..39 — 11 nodes — so the rows are root + those 11 + the
// leaf each one carries along: 23 of the 81.
const filtered = renderToString(<TreeView data={data} defaultExpandAll filter="child 3" />)
const filteredRows = filtered.match(/data-trt-index/g)?.length ?? 0
ok(filteredRows === 23, `filter left ${filteredRows} rows, expected 23 of 81`)
ok(filtered.includes('child 3<'), 'the match is rendered')
ok(filtered.includes('>root<'), 'and so is its ancestor')
ok(!filtered.includes('child 5'), 'a non-matching sibling is gone')
// "child 3" matches child-3 and child-30..39, whose leaves come along under them.
ok(filtered.includes('leaf 3<'), 'what sits under a match stays browsable')

const filterFn = renderToString(
  <TreeView data={data} defaultExpandAll filter={(node) => node.id === 'leaf-7'} />,
)
ok(filterFn.includes('leaf 7<'), 'a predicate filter matches on anything, here the id')
ok(!filterFn.includes('leaf 6'), 'and drops the rest')

// A blank string is not a filter at all.
const unfiltered = renderToString(<TreeView data={data} defaultExpandAll />)
const blank = renderToString(<TreeView data={data} defaultExpandAll filter="   " />)
ok(
  (blank.match(/data-trt-index/g)?.length ?? 0) ===
    (unfiltered.match(/data-trt-index/g)?.length ?? 0),
  'a blank filter renders the same rows as no filter',
)

console.error = warn
console.log(`\n${checks - failures}/${checks} assertions passed`)
if (failures > 0) process.exit(1)
