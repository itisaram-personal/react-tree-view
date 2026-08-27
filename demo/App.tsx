import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import { TreeView } from '../src'
import type { SelectionMode, TreeApi, TreeMenuItem, TreeNodeMeta } from '../src'
import { makeTree, makeWideTree, PRESETS, type DemoData, type DemoNode } from './data'

const FOLDER_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M1.5 4.2c0-.7.6-1.2 1.2-1.2h3l1.4 1.6h6.2c.7 0 1.2.5 1.2 1.2v6.3c0 .7-.5 1.2-1.2 1.2H2.7c-.6 0-1.2-.5-1.2-1.2V4.2Z"
      fill="currentColor"
      opacity="0.85"
    />
  </svg>
)

const FILE_ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path
      d="M4 1.8h5l3 3v9.4c0 .5-.4.9-.9.9H4a.9.9 0 0 1-.9-.9V2.7c0-.5.4-.9.9-.9Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <path d="M9 1.8v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

/** Appended to every label by the "Long labels" switch, to show rows wrapping. */
const LONG_TAIL =
  ' — generated/from/a/very/long/source/path.ts, with a description long enough that the row has to wrap onto a second and usually a third line'

function formatMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`
}

export function App() {
  const treeRef = useRef<TreeApi<DemoData> | null>(null)
  const [presetId, setPresetId] = useState<string>('large')
  const [dark, setDark] = useState(false)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('cascade')
  const [rowHeight, setRowHeight] = useState(28)
  const [wrapLabels, setWrapLabels] = useState(true)
  const [longLabels, setLongLabels] = useState(false)
  const [highlight, setHighlight] = useState(true)
  const [checkOnRowClick, setCheckOnRowClick] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [timing, setTiming] = useState<{ label: string; ms: number } | null>(null)
  const [checkedCount, setCheckedCount] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  // Bumped whenever tree state the stats panel reads has changed.
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[2]

  const { data, buildMs, nodeCount } = useMemo(() => {
    const started = performance.now()
    const tree = preset.wide
      ? makeWideTree(preset.wide)
      : makeTree(preset.depth, preset.branching, preset.target)
    let count = 0
    const stack = [...tree]
    while (stack.length > 0) {
      const node = stack.pop()!
      count++
      if (node.children) for (const child of node.children) stack.push(child)
    }
    return {
      data: tree,
      buildMs: performance.now() - started,
      nodeCount: count,
    }
  }, [preset])

  // The tree renders MUI checkboxes, so its palette has to follow the demo's.
  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: dark ? 'dark' : 'light',
          primary: { main: dark ? '#818cf8' : '#4f46e5' },
        },
      }),
    [dark],
  )

  // The stats read through the imperative handle, which only exists after mount.
  useEffect(bump, [data, bump])

  /** Wraps an API call so the panel can report how long it actually took. */
  const timed = useCallback((label: string, fn: () => void) => {
    const started = performance.now()
    fn()
    const ms = performance.now() - started
    setTiming({ label, ms })
  }, [])

  const refreshCheckedCount = useCallback(() => {
    const api = treeRef.current
    if (!api) return
    const started = performance.now()
    const ids = api.getCheckedIds({ mode: 'leaves' })
    setCheckedCount(ids.length)
    setTiming({
      label: `getCheckedIds (${ids.length} leaves)`,
      ms: performance.now() - started,
    })
  }, [])

  const contextMenu = useMemo<TreeMenuItem<DemoData>[]>(
    () => [
      {
        id: 'select-sublevel',
        // The node's direct children, with no `deep` option: the API default
        // follows the selection mode, so in cascade each child pulls in its own
        // subtree, and in independent only the children themselves are marked.
        label: 'Select all sub levels',
        shortcut: selectionMode === 'cascade' ? 'and below' : 'children only',
        disabled: ({ meta }) => !meta.hasChildren,
        onSelect: ({ nodeId, api }) => {
          timed('select sub level', () => api.check(api.getChildIds(nodeId)))
        },
      },
      {
        id: 'unselect-sublevel',
        label: 'Unselect all sub levels',
        shortcut: selectionMode === 'cascade' ? 'and below' : 'children only',
        disabled: ({ meta }) => !meta.hasChildren,
        onSelect: ({ nodeId, api }) => {
          timed('unselect sub level', () => api.uncheck(api.getChildIds(nodeId)))
        },
      },
      {
        id: 'select-one-sublevel',
        label: 'Select a sub level',
        disabled: ({ meta }) => !meta.hasChildren,
        // Resolved only when the submenu opens, so a node with thousands of
        // children costs nothing until someone asks for the list.
        submenu: ({ nodeId, api }) =>
          api.getChildIds(nodeId).map((childId) => {
            const child = api.getMeta(childId)
            const text = String(child?.node.label ?? childId)
            return {
              id: String(childId),
              label: text,
              text,
              shortcut:
                child && child.descendantCount > 0 ? String(child.descendantCount) : undefined,
              disabled: child?.disabled,
              onSelect: () => timed(`select ${text}`, () => api.check(childId)),
            }
          }),
      },
      { id: 'sep-0', separator: true },
      {
        id: 'check-self',
        label: 'Select just this node',
        onSelect: ({ nodeId, api }) => {
          timed('check node', () => api.check(nodeId, { deep: false }))
        },
      },
      {
        id: 'check-subtree',
        label: 'Select node and all children',
        onSelect: ({ nodeId, api }) => {
          timed('check subtree', () => api.check(nodeId, { deep: true }))
        },
      },
      {
        id: 'uncheck-subtree',
        label: 'Unselect node and all children',
        onSelect: ({ nodeId, api }) => {
          timed('uncheck subtree', () => api.uncheck(nodeId, { deep: true }))
        },
      },
      {
        id: 'count-inside',
        label: 'Count selected inside',
        onSelect: ({ nodeId, api, meta }) =>
          setTiming({
            label: `${meta.id}: ${api.getSelectedDescendantCount(nodeId)} selected inside`,
            ms: 0,
          }),
      },
      { id: 'sep-1', separator: true },
      {
        id: 'check-all',
        label: 'Select all nodes',
        shortcut: 'A',
        onSelect: ({ api }) => timed('checkAll', () => api.checkAll()),
      },
      {
        id: 'uncheck-all',
        label: 'Unselect all nodes',
        onSelect: ({ api }) => timed('uncheckAll', () => api.uncheckAll()),
      },
      { id: 'sep-2', separator: true },
      {
        id: 'expand-deep',
        label: 'Expand entire subtree',
        disabled: ({ meta }) => !meta.hasChildren,
        onSelect: ({ nodeId, api }) =>
          timed('expand deep', () => api.expand(nodeId, { deep: true })),
      },
      {
        id: 'collapse-deep',
        label: 'Collapse entire subtree',
        disabled: ({ meta }) => !meta.hasChildren,
        onSelect: ({ nodeId, api }) =>
          timed('collapse deep', () => api.collapse(nodeId, { deep: true })),
      },
      { id: 'sep-3', separator: true },
      {
        id: 'path',
        label: 'Log path to console',
        onSelect: ({ nodeId, api }) => console.log('path:', api.getPath(nodeId).join(' / ')),
      },
      {
        id: 'copy',
        label: 'Copy id',
        onSelect: ({ nodeId }) => navigator.clipboard?.writeText(String(nodeId)),
      },
      { id: 'sep-4', separator: true },
      {
        id: 'remove',
        label: 'Delete (demo only logs)',
        danger: true,
        onSelect: ({ node }) => console.log('delete requested for', node.id),
      },
    ],
    [timed, selectionMode],
  )

  const renderLabel = useCallback(
    (meta: TreeNodeMeta<DemoData>) => {
      const kind = meta.node.data?.kind
      return (
        <span className="demo-label">
          <span className={kind === 'folder' ? 'demo-icon demo-icon--folder' : 'demo-icon'}>
            {kind === 'folder' ? FOLDER_ICON : FILE_ICON}
          </span>
          <span className={meta.matched ? 'demo-name demo-name--match' : 'demo-name'}>
            {meta.node.label}
            {longLabels ? LONG_TAIL : ''}
          </span>
          {meta.hasChildren ? <span className="demo-badge">{meta.descendantCount}</span> : null}
          {meta.disabled ? <span className="demo-tag">locked</span> : null}
        </span>
      )
    },
    [longLabels],
  )

  const renderTrailing = useCallback(
    (meta: TreeNodeMeta<DemoData>) =>
      meta.node.data?.kind === 'file' ? (
        <span className="demo-size">{(meta.node.data.size / 1024).toFixed(1)} KB</span>
      ) : null,
    [],
  )

  const runFilter = useCallback(
    (next: string) => {
      setFilter(next)
      const started = performance.now()
      // The tree re-filters during its next render, so measure across the paint.
      requestAnimationFrame(() => {
        const api = treeRef.current
        setTiming({
          label: next.trim()
            ? `filter "${next.trim()}" → ${api?.getMatchCount().toLocaleString() ?? 0} matches`
            : 'filter cleared',
          ms: performance.now() - started,
        })
        bump()
      })
    },
    [bump],
  )

  const runSearch = useCallback(() => {
    const api = treeRef.current
    if (!api || !search.trim()) return
    const needle = search.trim().toLowerCase()
    const started = performance.now()
    // Walk the source data; the tree itself keeps no search index.
    const stack: DemoNode[] = [...data].reverse()
    while (stack.length > 0) {
      const node = stack.pop()!
      if (String(node.label).toLowerCase().includes(needle)) {
        api.scrollToNode(node.id, 'center')
        api.setActive(node.id)
        api.focus()
        setTiming({
          label: `found ${node.id}`,
          ms: performance.now() - started,
        })
        return
      }
      const children = node.children
      if (children) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
    }
    setTiming({ label: 'no match', ms: performance.now() - started })
  }, [data, search])

  const randomId = useCallback((): string | null => {
    let node: DemoNode | undefined = data[Math.floor(Math.random() * data.length)]
    while (node?.children && node.children.length > 0 && Math.random() > 0.15) {
      node = node.children[Math.floor(Math.random() * node.children.length)]
    }
    return node ? String(node.id) : null
  }, [data])

  return (
    <ThemeProvider theme={muiTheme}>
      <div className={dark ? 'demo demo--dark' : 'demo'}>
        <header className="demo-header">
          <div>
            <h1>react-tree-view</h1>
            <p className="demo-sub">
              Virtualized tri-state tree · {preset.target.toLocaleString()} node preset built in{' '}
              {formatMs(buildMs)}
            </p>
          </div>
          <label className="demo-switch">
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
            Dark
          </label>
        </header>

        <div className="demo-body">
          <aside className="demo-panel">
            <section>
              <h2>Dataset</h2>
              <div className="demo-chips">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={p.id === presetId ? 'chip chip--on' : 'chip'}
                    onClick={() => setPresetId(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2>Selection API</h2>
              <div className="demo-grid">
                <button onClick={() => timed('checkAll', () => treeRef.current?.checkAll())}>
                  Select all
                </button>
                <button onClick={() => timed('uncheckAll', () => treeRef.current?.uncheckAll())}>
                  Unselect all
                </button>
                <button
                  onClick={() =>
                    timed('check 500 random', () => {
                      const ids: string[] = []
                      for (let i = 0; i < 500; i++) {
                        const id = randomId()
                        if (id) ids.push(id)
                      }
                      treeRef.current?.check(ids)
                    })
                  }
                >
                  Check 500 random
                </button>
                <button
                  onClick={() =>
                    timed('check first root subtree', () =>
                      treeRef.current?.check(String(data[0]?.id ?? ''), {
                        deep: true,
                      }),
                    )
                  }
                >
                  Check root #1 subtree
                </button>
                <button onClick={refreshCheckedCount}>Count checked leaves</button>
                <button
                  onClick={() =>
                    timed('shallow ids', () => {
                      const ids = treeRef.current?.getCheckedIds({ mode: 'shallow' }) ?? []
                      console.log('topmost checked ids', ids)
                    })
                  }
                >
                  Log topmost checked
                </button>
              </div>
            </section>

            <section>
              <h2>Expansion API</h2>
              <div className="demo-grid">
                <button onClick={() => timed('expandAll', () => treeRef.current?.expandAll())}>
                  Expand all
                </button>
                <button onClick={() => timed('collapseAll', () => treeRef.current?.collapseAll())}>
                  Collapse all
                </button>
                <button onClick={() => timed('level 1', () => treeRef.current?.expandToLevel(1))}>
                  Expand to level 1
                </button>
                <button onClick={() => timed('level 3', () => treeRef.current?.expandToLevel(3))}>
                  Expand to level 3
                </button>
                <button
                  onClick={() =>
                    timed('scroll to random', () => {
                      const id = randomId()
                      if (id) {
                        treeRef.current?.scrollToNode(id, 'center')
                        treeRef.current?.setActive(id)
                      }
                    })
                  }
                >
                  Reveal random node
                </button>
                <button
                  onClick={() =>
                    timed('scroll to end', () =>
                      treeRef.current?.scrollToIndex(
                        (treeRef.current?.getVisibleCount() ?? 1) - 1,
                        'end',
                      ),
                    )
                  }
                >
                  Scroll to last row
                </button>
              </div>
            </section>

            <section>
              <h2>Filter</h2>
              <div className="demo-search">
                <input
                  value={filter}
                  placeholder="show matching only…"
                  onChange={(e) => runFilter(e.target.value)}
                />
                <button onClick={() => runFilter('')} disabled={filter === ''}>
                  Clear
                </button>
              </div>
              <p className="demo-hint">
                Narrows the tree to the matching nodes (marked), their ancestors and their contents,
                and opens the way down to them. Nothing is thrown away: check state survives, and
                clearing brings every row back.
              </p>
            </section>

            <section>
              <h2>Find</h2>
              <div className="demo-search">
                <input
                  value={search}
                  placeholder="label contains…"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                />
                <button onClick={runSearch}>Go</button>
              </div>
              <p className="demo-hint">
                Leaves the tree as it is and jumps to the first match: reveal, scroll to centre,
                make it the active row.
              </p>
            </section>

            <section>
              <h2>Selection mode</h2>
              <div className="demo-chips">
                {(['cascade', 'independent'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === selectionMode ? 'chip chip--on' : 'chip'}
                    onClick={() => setSelectionMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="demo-hint">
                {selectionMode === 'cascade'
                  ? 'Checking a node fills its subtree; parents roll up to indeterminate.'
                  : 'Each node owns its state. A badge counts the selections inside, including the ones hidden in collapsed branches.'}
              </p>
            </section>

            <section>
              <h2>Options</h2>
              <label className="demo-check">
                <input
                  type="checkbox"
                  checked={highlight}
                  onChange={(e) => setHighlight(e.target.checked)}
                />
                Highlight hovered children
              </label>
              <label className="demo-check">
                <input
                  type="checkbox"
                  checked={checkOnRowClick}
                  onChange={(e) => setCheckOnRowClick(e.target.checked)}
                />
                Row click toggles checkbox
              </label>
              <label className="demo-check">
                <input
                  type="checkbox"
                  checked={wrapLabels}
                  onChange={(e) => setWrapLabels(e.target.checked)}
                />
                Wrap labels (no horizontal scroll)
              </label>
              <label className="demo-check">
                <input
                  type="checkbox"
                  checked={longLabels}
                  onChange={(e) => setLongLabels(e.target.checked)}
                />
                Long labels
              </label>
              <label className="demo-range">
                Row height {rowHeight}px
                <input
                  type="range"
                  min={20}
                  max={44}
                  value={rowHeight}
                  onChange={(e) => setRowHeight(Number(e.target.value))}
                />
              </label>
            </section>

            <section className="demo-stats">
              <h2>Stats</h2>
              <dl>
                <div>
                  <dt>Nodes</dt>
                  <dd>{nodeCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Rows visible</dt>
                  <dd>{treeRef.current?.getVisibleCount().toLocaleString() ?? '—'}</dd>
                </div>
                <div>
                  <dt>Filter matches</dt>
                  <dd>
                    {filter.trim()
                      ? (treeRef.current?.getMatchCount().toLocaleString() ?? '—')
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Checked leaves</dt>
                  <dd>{checkedCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Hovered</dt>
                  <dd className="demo-mono">{hovered ?? '—'}</dd>
                </div>
                <div>
                  <dt>Last op</dt>
                  <dd>{timing ? `${timing.label} · ${formatMs(timing.ms)}` : '—'}</dd>
                </div>
              </dl>
              <p className="demo-hint">
                Right-click any row for the context menu; "Select a sub level" opens a submenu of
                that node's children, filtered and virtualized when there are many (try the Wide
                preset). Arrows navigate, Space toggles a checkbox, Alt+Arrow expands or collapses a
                subtree.
              </p>
            </section>
          </aside>

          <main className="demo-tree-wrap">
            <TreeView<DemoData>
              ref={treeRef}
              className={dark ? 'trt-dark' : undefined}
              data={data}
              filter={filter}
              rowHeight={rowHeight}
              wrapLabels={wrapLabels}
              selectionMode={selectionMode}
              defaultExpandLevel={1}
              highlightChildrenOnHover={highlight}
              checkOnRowClick={checkOnRowClick}
              contextMenu={contextMenu}
              contextMenuClassName={dark ? 'trt-dark' : undefined}
              renderLabel={renderLabel}
              renderTrailing={renderTrailing}
              onHoverChange={(meta) => setHovered(meta ? String(meta.id) : null)}
              onExpandChange={bump}
              onCheckChange={({ nodeId, checkState }) => {
                setTiming({
                  label: `check ${nodeId ?? 'all'} → ${['off', 'on', 'partial'][checkState]}`,
                  ms: 0,
                })
                bump()
              }}
              ariaLabel="Demo file tree"
            />
          </main>
        </div>
      </div>
    </ThemeProvider>
  )
}
