# react-tree-view

A virtualized React tree built for very large, very deep data — hundreds of thousands of nodes,
thirty levels down — with tri-state checkboxes, per-node deep expand/collapse, hovered-subtree
highlighting and a right-click menu.

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
| "Is this row inside the hovered subtree?" | two integer comparisons |
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
3. **Hover highlights the subtree** — the hovered node and all of its *expanded* descendants change
   colour (`--trt-hover-root` and `--trt-hover`). Toggle with `highlightSubtreeOnHover`.
4. **Two deep buttons per node** — expand or collapse the node and every descendant to the last
   leaf, next to the normal single-level caret.
5. **Context menu** — pass an array or a `(ctx) => items[]` function; items get `{ node, nodeId,
   meta, api, event }`, and support icons, shortcuts, separators, `danger`, dynamic `disabled` and
   **submenus** (see below).
6. **Imperative API** — everything below is available on the `ref`, and inside menu handlers.
7. **Virtualized** — fixed row height, windowed rendering with overscan, absolute rows positioned
   with `translateY`.
8. **Demo** — `npm run dev`: presets up to 300k nodes, a cascade/independent switch, live timings
   for every API call, dark mode, row-height slider, search-and-reveal.

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
| `rowHeight` | `28` | Uniform heights are what keep virtualization `O(1)`. |
| `overscan` | `8` | Extra rows above and below the viewport. |
| `indent` | `18` | Px per depth level. |
| `height` / `width` | `100%` | Applied to the scroll container. |
| `defaultCheckedIds` / `defaultExpandedIds` | — | Applied on mount. |
| `defaultExpandLevel` / `defaultExpandAll` | — | Initial expansion. |
| `selectionMode` | `'cascade'` | `'cascade'` or `'independent'` — see above. |
| `showCheckboxes` / `showDeepButtons` | `true` | |
| `showSelectedBadge` | mode-dependent | "n selected inside" badge; on by default in independent mode. |
| `renderBadge` | — | `(count, meta) => ReactNode`, replaces the default badge. |
| `highlightSubtreeOnHover` | `true` | |
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
```

`deep` defaults to `true` in cascade mode and `false` in independent mode — the same thing a click
on the checkbox does. `mode: 'shallow'` returns only the topmost fully checked nodes — usually what you want to send to a
server, since it collapses a 100k-node selection into a handful of ids.

## Keyboard

`↑` `↓` `PageUp` `PageDown` `Home` `End` move the active row · `→` expands or steps into the
subtree · `←` collapses or steps to the parent · `Alt` with either arrow makes it a deep
expand/collapse · `Space` toggles the checkbox · `Enter` toggles expansion.

## Theming

The checkbox is MUI's, so its colour and light/dark mode come from the surrounding
`ThemeProvider` — `palette.primary` drives the checked and indeterminate states. Only its geometry
is pinned by this package (`.trt-check .MuiCheckbox-root { padding: 0 }`), so every row stays
exactly `rowHeight` tall.

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
