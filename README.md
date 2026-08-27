# react-tree-view

A virtualized React tree built for very large, very deep data — hundreds of thousands of nodes,
thirty levels down — with tri-state checkboxes, per-node deep expand/collapse, hover highlighting
and a right-click menu.

Peer dependencies: React 17+ and MUI (`@mui/material` with `@emotion/react` / `@emotion/styled`),
whose `Checkbox` the rows render, so the boxes follow your MUI theme — including dark mode — with no
extra wiring.

```bash
npm install @mui/material @emotion/react @emotion/styled
npm install   # then:
npm run dev   # interactive demo on http://localhost:5199
npm test      # store + render assertions
npm run build # dist/ (esm + cjs + d.ts + styles.css)
```

## Quick start

```tsx
import { useRef } from 'react'
import { TreeView } from 'react-tree-view'
import type { TreeApi, TreeNodeSource } from 'react-tree-view'
import 'react-tree-view/styles.css'

const data: TreeNodeSource[] = [
  { id: 'src', label: 'src', children: [{ id: 'src/app.tsx', label: 'app.tsx' }] },
]

export function Sidebar() {
  const tree = useRef<TreeApi | null>(null)

  return (
    <>
      <button onClick={() => tree.current?.check('src')}>Select src</button>
      <TreeView
        ref={tree}
        data={data}
        rowHeight={28}
        defaultExpandLevel={1}
        renderLabel={(meta) => <><Icon node={meta.node} /> {meta.node.label}</>}
        contextMenu={[
          { id: 'all', label: 'Select all', onSelect: ({ api }) => api.checkAll() },
          { id: 'sub', label: 'Select subtree', onSelect: ({ nodeId, api }) => api.check(nodeId) },
        ]}
        onCheckChange={({ getCheckedIds }) => console.log(getCheckedIds({ mode: 'shallow' }))}
      />
    </>
  )
}
```

## How it stays fast

The source tree is flattened once into parallel typed arrays in **depth-first order**. That single
choice makes the descendants of node `i` a contiguous range `[i + 1, i + descendantCount[i]]`, so:

| Operation | Cost |
| --- | --- |
| Check / uncheck a subtree | one linear pass over that range + an `O(depth)` walk to the root |
| Deep expand / collapse | one `fill()` over that range |
| "Is this row the hovered one or a child of it?" | two integer comparisons |
| Rebuilding the visible row list | one pass that *skips* collapsed subtrees whole |
| Parent tri-state | derived from per-node checked/indeterminate child tallies, never re-counted |

Check state lives in a `Uint8Array` (0/1/2), expansion in another; nothing is allocated per node
during interaction, and React never diffs more than the rows in the viewport. The MUI checkbox is
the heaviest thing in a row, so it is rendered with `disableRipple` and a hoisted static
`slotProps` object, and its input is inert — the delegated handler owns the click. Rows carry **no event
handlers** — clicks, right-clicks and hover are picked up by delegated listeners on the scroll
container and routed through `data-trt-*` attributes.

Measured on a 137k-node / 6-level tree (`npm test`, Node 24):
build 58 ms · visible-row rebuild 1.2 ms · deep-check the entire tree 2.5 ms · collect 117k
checked leaf ids 6.7 ms.

## Two selection models

`selectionMode` decides what a checkbox means:

| | `cascade` (default) | `independent` |
| --- | --- | --- |
| Clicking a checkbox | fills the whole subtree | toggles that node only |
| A parent's state | derived from its children (can be indeterminate) | its own, explicit, never derived |
| Selections hidden in a collapsed branch | shown as an indeterminate parent | shown as a **count badge** on every ancestor |
| `getCheckedIds({ mode: 'shallow' })` | topmost checked nodes | same as `'all'` — a checked node says nothing about its children |
| Badge (`showSelectedBadge`) | off by default | on by default |

Use `independent` when a node's selection is a fact about *that* node — a permission, a flag, a row
to export — rather than a summary of what is underneath it.

```tsx
<TreeView
  data={data}
  selectionMode="independent"
  renderBadge={(count) => <span className="my-badge">{count} inside</span>}
/>
```

The badge counts every checked node below, at any depth, and is maintained incrementally: toggling
one node is `O(depth)`, and a deep operation costs one pass over that subtree. `api.check(id, {
deep: true })` still marks a whole subtree explicitly in independent mode, and
`api.getSelectedDescendantCount(id)` returns the badge number.

Switching the prop at runtime rebuilds the store and carries explicit state over: cascade →
independent keeps every fully checked node (indeterminate parents drop out, since they were never
explicitly chosen); independent → cascade keeps leaves and re-derives the parents.

## Features

1. **Tri-state checkboxes** — MUI `Checkbox` rows: unchecked / indeterminate / checked, derived
   bottom-up, or fully independent per node with a count badge (see above). Disabled branches are
   skipped by every bulk operation and keep their own state.
2. **Custom labels** — `renderLabel`, plus `renderIcon` and `renderTrailing` slots and
   `rowClassName`. Anything React can render works.
3. **Hover highlights the children** — the hovered node and its direct children change colour
   (`--trt-hover-root` and `--trt-hover`); grandchildren are left alone. Toggle with
   `highlightChildrenOnHover`.
4. **Two deep buttons per node** — expand or collapse the node and every descendant to the last
   leaf. They follow the label, appear on hover, and only on nodes that have children.
5. **Context menu** — pass an array or a `(ctx) => items[]` function; items get `{ node, nodeId,
   meta, api, event }`, and support icons, shortcuts, separators, `danger`, dynamic `disabled` and
   **submenus** (see below).
6. **Imperative API** — everything below is available on the `ref`, and inside menu handlers.
7. **Virtualized** — windowed rendering with overscan, absolute rows positioned with `translateY`.
   Rows are uniform until a label wraps, and measured after layout when one does.
8. **No horizontal scrolling** — a label too long for the width wraps onto more lines and the row
   grows taller (`wrapLabels`, on by default). `wrapLabels={false}` restores uniform rows that
   ellipsize and scroll sideways.
9. **Filter** — `filter="text"` (or a predicate) narrows the tree to the matching nodes, their
   ancestors and their contents, opening the way down to each match. Three O(n) passes over the
   flat arrays; nothing is rebuilt, so clearing it brings every row straight back.
10. **Demo** — `npm run dev`: presets up to 300k nodes, a cascade/independent switch, live timings
   for every API call, dark mode, row-height slider, label wrapping, filter, find-and-reveal.

## Context menus and submenus

An item with `submenu` opens a nested panel instead of firing. Pass a function and it is resolved
**when the submenu opens**, so listing the children of a node costs nothing until someone asks:

```tsx
contextMenu={[
  {
    id: 'select-a-sub-level',
    label: 'Select a sub level',
    disabled: ({ meta }) => !meta.hasChildren,
    submenu: ({ nodeId, api }) =>
      api.getChildIds(nodeId).map((childId) => {
        const child = api.getMeta(childId)!
        return {
          id: String(childId),
          label: String(child.node.label),
          text: String(child.node.label),        // what the filter box matches
          shortcut: String(child.descendantCount),
          onSelect: () => api.check(childId),    // depth follows the selection mode
        }
      }),
  },
]}
```

Right-clicking `a` in `[a: [a1, a2, a3], b: [b1, b2]]` then offers `a1` / `a2` / `a3`; right-clicking
`b2` offers `b21` / `b22`.

A panel handles a very large level on its own:

| Entries | What the panel does |
| --- | --- |
| any | scrolls inside `max-height: 320px`, flips to stay on screen |
| > 12 | shows a filter box that matches `text` (or a string `label`) |
| > 40 | windows the list — only the visible ~15 rows are in the DOM |

So a node with 5 000 children opens as fast as one with 5. Keyboard: `↑` `↓` move, `→` / `Enter`
open a submenu, `←` / `Esc` close it, typing filters. Try the demo's **Wide (5K siblings)** preset.

## Props

| Prop | Default | Notes |
| --- | --- | --- |
| `data` | — | `TreeNodeSource[]`. Check/expand state is preserved by id when this changes. |
| `filter` | — | `string` (label contains, case-insensitive) or `(node, index) => boolean`. See below. |
| `rowHeight` | `28` | Minimum row height, and the estimate for rows not measured yet. With `wrapLabels={false}` it is the fixed height of every row. |
| `wrapLabels` | `true` | Wrap long labels instead of scrolling sideways; rows grow taller. `false` = uniform rows, ellipsis, horizontal scroll. |
| `overscan` | `8` | Extra rows above and below the viewport. |
| `indent` | `18` | Px per depth level. |
| `height` / `width` | `100%` | Applied to the scroll container. |
| `defaultCheckedIds` / `defaultExpandedIds` | — | Applied on mount. |
| `defaultExpandLevel` / `defaultExpandAll` | — | Initial expansion. |
| `selectionMode` | `'cascade'` | `'cascade'` or `'independent'` — see above. |
| `showCheckboxes` / `showDeepButtons` | `true` | |
| `showSelectedBadge` | mode-dependent | "n selected inside" badge; on by default in independent mode. |
| `renderBadge` | — | `(count, meta) => ReactNode`, replaces the default badge. |
| `highlightChildrenOnHover` | `true` | Tints the hovered row and its direct children. |
| `checkOnRowClick` / `expandOnRowClick` | `false` | Row-body click behaviour. |
| `toggleOnDoubleClick` | `true` | |
| `renderLabel` / `renderIcon` / `renderTrailing` / `rowClassName` | — | Receive the node meta, including `selectedDescendantCount`. |
| `contextMenu` / `contextMenuClassName` | — | Items or a factory. |
| `onCheckChange` / `onExpandChange` | — | `onCheckChange` hands you a lazy `getCheckedIds()`; it does not walk the tree unless you call it. |
| `onNodeClick` / `onNodeDoubleClick` / `onNodeContextMenu` | — | Call `event.preventDefault()` to suppress the built-in behaviour. |
| `onActiveChange` / `onHoverChange` / `onVisibleRangeChange` | — | |
| `ariaLabel` | `'Tree'` | |

## Imperative API (`ref`)

```ts
// selection
check(ids, { deep })             uncheck(ids, { deep })     setChecked(ids, checked, opts)
toggleCheck(id)                  checkAll()                 uncheckAll()
getCheckState(id)                getCheckedIds({ mode: 'all' | 'leaves' | 'shallow', includeIndeterminate })
getCheckedNodes(opts)            getSelectedDescendantCount(id)

// expansion
expand(ids, { deep })            collapse(ids, { deep })    toggleExpand(id)
expandAll()                      collapseAll()              expandToLevel(level)
reveal(id)                       isExpanded(id)             getExpandedIds()

// navigation
scrollToNode(id, 'auto' | 'start' | 'center' | 'end')       scrollToIndex(row, align)
setActive(id)                    getActiveId()              focus()

// inspection
getNode(id)  getMeta(id)  getParentId(id)  getChildIds(id)  getPath(id)
getNodeCount()  getVisibleCount()  getVisibleIds()

// filter
getMatchCount()  getMatchedIds()  isMatch(id)
```

`deep` defaults to `true` in cascade mode and `false` in independent mode — the same thing a click
on the checkbox does. `mode: 'shallow'` returns only the topmost fully checked nodes — usually what you want to send to a
server, since it collapses a 100k-node selection into a handful of ids.

## Keyboard

`↑` `↓` `PageUp` `PageDown` `Home` `End` move the active row · `→` expands or steps into the
subtree · `←` collapses or steps to the parent · `Alt` with either arrow makes it a deep
expand/collapse · `Space` toggles the checkbox · `Enter` toggles expansion.

## Filtering

```tsx
const [text, setText] = useState('')
<TreeView data={data} filter={text} />          // or filter={(node) => node.data?.failing}
```

A filter keeps three kinds of row: the **matches**, their **ancestors** (so a match can be reached,
and every one of them is expanded, which is what puts the matches on screen) and their
**descendants** (so opening a matching folder still shows what is inside it). Everything else is
skipped whole — a dropped node cannot contain a match, so its subtree is jumped over in one step,
and the row walk stays proportional to what is on screen.

Filtering is a view, not an edit. Check state, expansion, ids and the whole imperative API keep
covering every node, so `getCheckedIds()` under a filter still returns selections you cannot
currently see, and clearing the filter brings the rows straight back. A blank string is not a
filter.

`meta.matched` is true for the nodes that matched themselves, so `renderLabel` can mark them apart
from the ones kept for context. `api.getMatchCount()`, `api.getMatchedIds()` and `api.isMatch(id)`
report the same thing imperatively.

Cost is three passes over the flat arrays — test, propagate up, propagate down — about 30 ms for
137k nodes, dominated by your predicate. A `string` filter is a value, so it can change every
render; **memoize a function filter** (`useCallback`), since a new identity re-filters the tree.

Filtering and finding are different things, and the demo shows both: **Filter** narrows the tree,
**Find** leaves it alone and jumps to the first match (`reveal` + `scrollToNode(id, 'center')` +
`setActive`).

## Wrapping and row heights

By default the tree never scrolls horizontally: `.trt-label` wraps at whitespace (and inside a word
when a single token is too long to fit), so a long label makes its row taller instead of pushing the
content sideways. `rowHeight` becomes the minimum. Rows are measured in a layout effect after every
commit, before the browser paints, and the offsets are a prefix sum over those heights — so
`scrollToNode`, the scrollbar and the keyboard keep working with rows of different heights. Rows
that have never been on screen count as `rowHeight` until they are measured, which is why a jump
into unvisited territory re-aims itself once its rows arrive.

The caret, the deep buttons, the checkbox and `renderIcon` stay on the first line of a wrapped row
(they are `var(--trt-row-h)` tall, which the component sets from `rowHeight`). A custom
`renderLabel` decides its own wrapping: use inline flow rather than a flex row if you want the text
to wrap under an icon rather than push it onto a line of its own — the demo's `.demo-label` shows
this in both modes.

Set `wrapLabels={false}` for the uniform-height behaviour: one line per row, an ellipsis on
overflow, and horizontal scrolling as wide as the widest row.

## Theming

The checkbox is MUI's, so its colour and light/dark mode come from the surrounding
`ThemeProvider` — `palette.primary` drives the checked and indeterminate states. Only its geometry
is pinned by this package (`.trt-check .MuiCheckbox-root { padding: 0 }`), so the checkbox never
grows a row on its own.

Everything else is a CSS variable on `.trt-root` (`--trt-hover`, `--trt-hover-root`, `--trt-accent`,
`--trt-border`, `--trt-menu-*`, …). Add the bundled `trt-dark` class for the dark palette, or set
the variables yourself:

```css
.my-tree.trt-root {
  --trt-accent: #0ea5e9;
  --trt-hover-root: #e0f2fe;
}
```

## Source layout

```
src/model.ts       depth-first flattening into typed arrays (parent/depth/descendants/CSR children)
src/store.ts       check + expand state, visible-row list, subscription for useSyncExternalStore
src/TreeView.tsx   virtualization, delegated events, keyboard, imperative API
src/TreeRow.tsx    handler-free row markup
src/ContextMenu.tsx portal menu with viewport flipping
src/styles.css     themeable styles
tests/             dependency-free assertions (npm test)
demo/              Vite playground
```
