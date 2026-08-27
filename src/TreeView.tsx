import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  CSSProperties,
  ForwardedRef,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import { TreeStore } from './store'
import { TreeRow } from './TreeRow'
import { ContextMenu } from './ContextMenu'
import type {
  CheckOptions,
  CheckState,
  CheckedIdsOptions,
  ExpandOptions,
  ScrollAlign,
  TreeApi,
  TreeMenuContext,
  TreeMenuItem,
  TreeNodeId,
  TreeFilterFn,
  TreeNodeMeta,
  TreeNodeSource,
  TreeViewProps,
} from './types'

/**
 * Row geometry. With uniform rows it is pure arithmetic; when labels wrap it is
 * a prefix sum over the measured heights, searched with a bisect. Rows that have
 * not been measured yet count as `rowHeight`.
 */
interface RowLayout {
  count: number
  totalHeight: number
  /** Distance from the top of the canvas to the top of a row. */
  topOf: (row: number) => number
  heightOf: (row: number) => number
  /** The row containing `y`, clamped to the ends. */
  rowAt: (y: number) => number
}

interface MenuState<T> {
  x: number
  y: number
  items: TreeMenuItem<T>[]
  ctx: TreeMenuContext<T>
}

function toArray(ids: TreeNodeId | TreeNodeId[]): TreeNodeId[] {
  return Array.isArray(ids) ? ids : [ids]
}

/**
 * The `filter` prop as the store wants it. A blank string is no filter at all,
 * so clearing the box brings every row back.
 */
function toPredicate<T>(filter: string | TreeFilterFn<T> | undefined): TreeFilterFn<T> | null {
  if (filter === undefined || filter === null) return null
  if (typeof filter !== 'string') return filter
  const needle = filter.trim().toLowerCase()
  if (needle === '') return null
  return (node) =>
    String(node.label ?? node.id)
      .toLowerCase()
      .includes(needle)
}

function TreeViewInner<T>(props: TreeViewProps<T>, ref: ForwardedRef<TreeApi<T>>) {
  const {
    data,
    rowHeight = 28,
    overscan = 8,
    indent = 18,
    height = '100%',
    width = '100%',
    className,
    style,
    selectionMode = 'cascade',
    wrapLabels = true,
    showCheckboxes = true,
    showDeepButtons = true,
    highlightChildrenOnHover = true,
    contextMenuClassName,
    ariaLabel = 'Tree',
  } = props
  const cascades = selectionMode === 'cascade'
  // In independent mode the badge is the only hint that a collapsed branch
  // holds selections, so it is on by default there.
  const showSelectedBadge = props.showSelectedBadge ?? !cascades

  // Latest props without re-binding the delegated listeners on every render.
  const propsRef = useRef(props)
  propsRef.current = props

  const initRef = useRef({
    checkedIds: props.defaultCheckedIds,
    expandedIds: props.defaultExpandedIds,
    expandLevel: props.defaultExpandLevel,
    expandAll: props.defaultExpandAll,
    selectionMode,
  })
  initRef.current.selectionMode = selectionMode

  const storeRef = useRef<TreeStore<T> | null>(null)
  const store = useMemo(() => {
    // Changing the selection mode rebuilds the store; explicit state carries over.
    const next = new TreeStore<T>(data, initRef.current, storeRef.current ?? undefined)
    storeRef.current = next
    return next
  }, [data, selectionMode])

  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)

  // Applied during render, like `ensureVisible()` below: the row list has to be
  // in step with the prop by the time the rows are built. A new store (a `data`
  // or selection-mode change) starts unfiltered, so it needs the filter again.
  const filterRef = useRef<{ store: TreeStore<T> | null; filter: unknown }>({
    store: null,
    filter: undefined,
  })
  if (filterRef.current.store !== store || filterRef.current.filter !== props.filter) {
    filterRef.current = { store, filter: props.filter }
    store.setFilter(toPredicate(props.filter))
  }

  const { model } = store
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [menu, setMenu] = useState<MenuState<T> | null>(null)

  // ------------------------------------------------------------------- viewport

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const read = () => {
      setViewportHeight(el.clientHeight)
      setViewportWidth(el.clientWidth)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // --------------------------------------------------------- row measurements

  /** Measured row heights by node index; 0 means "not measured yet". */
  const heights = useMemo(() => new Float64Array(wrapLabels ? model.size : 0), [model, wrapLabels])
  const [measureVersion, setMeasureVersion] = useState(0)
  const measuredWidthRef = useRef(-1)
  const pendingScrollRef = useRef<{ row: number; align: ScrollAlign; tries: number } | null>(null)
  const offsetsRef = useRef<Float64Array>(new Float64Array(1))

  store.ensureVisible()
  const visibleVersion = store.visibleVersion

  const layout = useMemo<RowLayout>(() => {
    const count = store.visibleCount
    if (!wrapLabels) {
      const last = Math.max(0, count - 1)
      return {
        count,
        totalHeight: count * rowHeight,
        topOf: (row) => row * rowHeight,
        heightOf: () => rowHeight,
        rowAt: (y) => Math.max(0, Math.min(last, Math.floor(y / rowHeight))),
      }
    }

    // A different width wraps labels differently, so every height is stale.
    if (measuredWidthRef.current !== viewportWidth) {
      measuredWidthRef.current = viewportWidth
      heights.fill(0)
    }

    let offsets = offsetsRef.current
    if (offsets.length < count + 1) {
      offsets = new Float64Array(count + 1)
      offsetsRef.current = offsets
    }
    const { visible } = store
    let acc = 0
    offsets[0] = 0
    for (let row = 0; row < count; row++) {
      acc += heights[visible[row]] || rowHeight
      offsets[row + 1] = acc
    }

    return {
      count,
      totalHeight: acc,
      topOf: (row) => offsets[Math.max(0, Math.min(count, row))],
      heightOf: (row) => (row >= 0 && row < count ? offsets[row + 1] - offsets[row] : rowHeight),
      rowAt: (y) => {
        // Bisect for the last row whose top is at or above y.
        let low = 0
        let high = count - 1
        while (low < high) {
          const mid = (low + high + 1) >> 1
          if (offsets[mid] <= y) low = mid
          else high = mid - 1
        }
        return Math.max(0, low)
      },
    }
    // `visibleVersion` covers rows appearing and disappearing, `measureVersion`
    // new measurements. A check state change bumps neither, so it costs nothing.
  }, [store, visibleVersion, measureVersion, viewportWidth, heights, rowHeight, wrapLabels])

  // Handlers read the layout through a ref so their identity never changes with it.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const total = layout.count
  const windowHeight = viewportHeight || rowHeight * 20
  const start = Math.max(0, layout.rowAt(scrollTop) - overscan)
  const end = Math.min(total, layout.rowAt(scrollTop + windowHeight) + 1 + overscan)

  /**
   * Rows are measured after every commit, before the browser paints, so the
   * corrected offsets are never on screen. Only the rendered window is read.
   */
  useLayoutEffect(() => {
    if (!wrapLabels) return
    const canvas = canvasRef.current
    if (!canvas) return
    const pending = pendingScrollRef.current
    // The node behind a pending jump, to tell "the row is where we put it" from
    // "the row has not even been rendered yet".
    const target = pending ? store.visible[pending.row] : -1
    let targetRendered = false
    const rows = canvas.children
    let changed = false
    for (let k = 0; k < rows.length; k++) {
      const el = rows[k] as HTMLElement
      const attr = el.dataset.trtIndex
      if (attr === undefined) continue
      const index = +attr
      if (index === target) targetRendered = true
      const measured = el.offsetHeight
      if (measured > 0 && heights[index] !== measured) {
        heights[index] = measured
        changed = true
      }
    }
    if (changed) setMeasureVersion((version) => version + 1)

    // The offsets in `layoutRef` are this render's, so a pending jump can be
    // re-aimed at the row it was meant for now that more rows are measured. It
    // is settled once the row is on screen and a pass neither measures anything
    // new nor moves the viewport.
    if (pending) {
      const moved = applyScroll(pending.row, pending.align)
      const settled = targetRendered && !changed && !moved
      if (!settled && pending.tries < 12) pending.tries++
      else pendingScrollRef.current = null
    }
  })

  useEffect(() => {
    propsRef.current.onVisibleRangeChange?.(start, end)
  }, [start, end])

  // ------------------------------------------------------------------- helpers

  const makeMeta = useCallback(
    (index: number): TreeNodeMeta<T> => {
      const parent = model.parent[index]
      const childCount = store.childCount(index)
      return {
        node: model.nodes[index],
        id: model.ids[index],
        index,
        depth: model.depth[index],
        parentId: parent >= 0 ? model.ids[parent] : null,
        childCount,
        descendantCount: model.descendants[index],
        hasChildren: childCount > 0,
        expanded: store.expanded[index] === 1,
        checkState: store.checkState[index] as CheckState,
        selectedDescendantCount: store.selectedInside[index],
        disabled: model.disabled[index] === 1,
        highlighted: false,
        active: store.activeIndex === index,
        matched: store.matched[index] === 1,
      }
    },
    [store, model],
  )

  /** Puts a row where `align` asks for. Returns true when the viewport moved. */
  const applyScroll = useCallback((visibleIndex: number, align: ScrollAlign): boolean => {
    const el = viewportRef.current
    if (!el) return false
    const { topOf, heightOf } = layoutRef.current
    const top = topOf(visibleIndex)
    const rowH = heightOf(visibleIndex)
    const height = el.clientHeight
    const before = el.scrollTop
    if (align === 'start') el.scrollTop = top
    else if (align === 'end') el.scrollTop = top - height + rowH
    else if (align === 'center') el.scrollTop = top - height / 2 + rowH / 2
    else if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowH > el.scrollTop + height) el.scrollTop = top - height + rowH
    return Math.abs(el.scrollTop - before) > 0.5
  }, [])

  const scrollToIndex = useCallback(
    (visibleIndex: number, align: ScrollAlign = 'auto') => {
      if (visibleIndex < 0) return
      // Rows that have never been on screen are still estimates, so the first
      // jump can land short. `pendingScrollRef` re-aims it while the rows it
      // scrolled past are being measured — see the measuring effect.
      pendingScrollRef.current =
        (propsRef.current.wrapLabels ?? true) ? { row: visibleIndex, align, tries: 0 } : null
      applyScroll(visibleIndex, align)
    },
    [applyScroll],
  )

  const apiRef = useRef<TreeApi<T> | null>(null)

  const emitCheckChange = useCallback(
    (index: number) => {
      const handler = propsRef.current.onCheckChange
      if (!handler) return
      handler({
        node: index >= 0 ? model.nodes[index] : null,
        nodeId: index >= 0 ? model.ids[index] : null,
        checkState: index >= 0 ? (store.checkState[index] as CheckState) : 0,
        api: apiRef.current as TreeApi<T>,
        getCheckedIds: (options?: CheckedIdsOptions) => store.getCheckedIds(options),
      })
    },
    [store, model],
  )

  const emitExpandChange = useCallback(
    (index: number, expanded: boolean, deep: boolean) => {
      const handler = propsRef.current.onExpandChange
      if (!handler) return
      handler({
        node: index >= 0 ? model.nodes[index] : null,
        nodeId: index >= 0 ? model.ids[index] : null,
        expanded,
        deep,
        api: apiRef.current as TreeApi<T>,
      })
    },
    [store, model],
  )

  const setActiveIndex = useCallback(
    (index: number) => {
      if (store.activeIndex === index) return
      store.activeIndex = index
      store.emit()
      propsRef.current.onActiveChange?.(index >= 0 ? makeMeta(index) : null)
    },
    [store, makeMeta],
  )

  // ------------------------------------------------------------ imperative api

  const api = useMemo<TreeApi<T>>(() => {
    const setChecked = (
      ids: TreeNodeId | TreeNodeId[],
      checked: boolean,
      options?: CheckOptions,
    ) => {
      const deep = options?.deep ?? store.cascades
      let changed = false
      let last = -1
      for (const id of toArray(ids)) {
        const index = store.indexOf(id)
        if (index < 0) continue
        if (store.setSubtreeCheck(index, checked ? 1 : 0, deep)) {
          changed = true
          last = index
        }
      }
      if (!changed) return
      store.emit()
      if (!options?.silent) emitCheckChange(last)
    }

    const setExpanded = (
      ids: TreeNodeId | TreeNodeId[],
      expanded: boolean,
      options?: ExpandOptions,
    ) => {
      const deep = options?.deep ?? false
      let changed = false
      let last = -1
      for (const id of toArray(ids)) {
        const index = store.indexOf(id)
        if (index < 0) continue
        if (store.setExpanded(index, expanded, deep)) {
          changed = true
          last = index
        }
      }
      if (!changed) return
      store.emit()
      if (!options?.silent) emitExpandChange(last, expanded, deep)
    }

    return {
      check: (ids, options) => setChecked(ids, true, options),
      uncheck: (ids, options) => setChecked(ids, false, options),
      setChecked,
      toggleCheck: (id, options) => {
        const index = store.indexOf(id)
        if (index < 0) return
        setChecked(id, store.checkState[index] !== 1, options)
      },
      checkAll: () => {
        store.setAllChecked(1)
        store.emit()
        emitCheckChange(-1)
      },
      uncheckAll: () => {
        store.setAllChecked(0)
        store.emit()
        emitCheckChange(-1)
      },
      getCheckState: (id) => {
        const index = store.indexOf(id)
        return index < 0 ? undefined : (store.checkState[index] as CheckState)
      },
      getCheckedIds: (options) => store.getCheckedIds(options),
      getSelectedDescendantCount: (id) => {
        const index = store.indexOf(id)
        return index < 0 ? 0 : store.selectedInside[index]
      },
      getCheckedNodes: (options) =>
        store
          .getCheckedIds(options)
          .map((id) => model.nodes[store.indexOf(id)])
          .filter(Boolean) as TreeNodeSource<T>[],

      expand: (ids, options) => setExpanded(ids, true, options),
      collapse: (ids, options) => setExpanded(ids, false, options),
      toggleExpand: (id, options) => {
        const index = store.indexOf(id)
        if (index < 0) return
        setExpanded(id, store.expanded[index] !== 1, options)
      },
      expandAll: () => {
        store.setAllExpanded(true)
        store.emit()
        emitExpandChange(-1, true, true)
      },
      collapseAll: () => {
        store.setAllExpanded(false)
        store.emit()
        emitExpandChange(-1, false, true)
      },
      expandToLevel: (level) => {
        store.expandToLevel(level)
        store.emit()
        emitExpandChange(-1, true, true)
      },
      reveal: (id) => {
        const index = store.indexOf(id)
        if (index < 0) return
        if (store.reveal(index)) store.emit()
      },
      isExpanded: (id) => {
        const index = store.indexOf(id)
        return index >= 0 && store.expanded[index] === 1
      },
      getExpandedIds: () => store.getExpandedIds(),

      scrollToNode: (id, align) => {
        const index = store.indexOf(id)
        if (index < 0) return
        if (store.reveal(index)) store.emit()
        scrollToIndex(store.visibleIndexOf(index), align)
      },
      scrollToIndex,
      setActive: (id) => setActiveIndex(id === null ? -1 : store.indexOf(id)),
      getActiveId: () => store.idAt(store.activeIndex),
      focus: () => viewportRef.current?.focus(),

      getNode: (id) => {
        const index = store.indexOf(id)
        return index < 0 ? undefined : model.nodes[index]
      },
      getMeta: (id) => {
        const index = store.indexOf(id)
        return index < 0 ? undefined : makeMeta(index)
      },
      getParentId: (id) => {
        const index = store.indexOf(id)
        if (index < 0) return null
        const parent = model.parent[index]
        return parent >= 0 ? model.ids[parent] : null
      },
      getChildIds: (id) => {
        const index = store.indexOf(id)
        if (index < 0) return []
        const out: TreeNodeId[] = []
        for (let k = model.childStart[index]; k < model.childStart[index + 1]; k++) {
          out.push(model.ids[model.childIndex[k]])
        }
        return out
      },
      getPath: (id) => {
        const index = store.indexOf(id)
        if (index < 0) return []
        const path: TreeNodeId[] = []
        for (let i = index; i >= 0; i = model.parent[i]) path.push(model.ids[i])
        return path.reverse()
      },
      getNodeCount: () => model.size,
      getVisibleCount: () => {
        store.ensureVisible()
        return store.visibleCount
      },
      getVisibleIds: () => {
        store.ensureVisible()
        const out: TreeNodeId[] = new Array(store.visibleCount)
        for (let i = 0; i < store.visibleCount; i++) out[i] = model.ids[store.visible[i]]
        return out
      },

      getMatchCount: () => store.matchCount,
      getMatchedIds: () => store.getMatchedIds(),
      isMatch: (id) => {
        const index = store.indexOf(id)
        return index >= 0 && store.isMatch(index)
      },
    }
  }, [store, model, makeMeta, scrollToIndex, setActiveIndex, emitCheckChange, emitExpandChange])

  apiRef.current = api
  useImperativeHandle(ref, () => api, [api])

  // ------------------------------------------------------------ interactions

  const toggleCheckAt = useCallback(
    (index: number) => {
      if (index < 0 || model.disabled[index] === 1) return
      if (!store.toggleCheck(index, store.cascades)) return
      store.emit()
      emitCheckChange(index)
    },
    [store, model, emitCheckChange],
  )

  const setExpandedAt = useCallback(
    (index: number, expanded: boolean, deep: boolean) => {
      if (!store.setExpanded(index, expanded, deep)) return
      store.emit()
      emitExpandChange(index, expanded, deep)
    },
    [store, emitExpandChange],
  )

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const rowEl = target.closest('[data-trt-index]') as HTMLElement | null
      if (!rowEl) return
      const index = Number(rowEl.dataset.trtIndex)
      const action = (target.closest('[data-trt-action]') as HTMLElement | null)?.dataset.trtAction

      setActiveIndex(index)

      if (action === 'toggle') {
        setExpandedAt(index, store.expanded[index] !== 1, false)
        return
      }
      if (action === 'expand-deep') {
        setExpandedAt(index, true, true)
        return
      }
      if (action === 'collapse-deep') {
        setExpandedAt(index, false, true)
        return
      }
      if (action === 'check') {
        toggleCheckAt(index)
        return
      }

      const current = propsRef.current
      current.onNodeClick?.(makeMeta(index), event)
      if (event.defaultPrevented) return
      if (current.checkOnRowClick) toggleCheckAt(index)
      if (current.expandOnRowClick && store.childCount(index) > 0) {
        setExpandedAt(index, store.expanded[index] !== 1, false)
      }
    },
    [store, makeMeta, setActiveIndex, setExpandedAt, toggleCheckAt],
  )

  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const rowEl = (event.target as HTMLElement).closest('[data-trt-index]') as HTMLElement | null
      if (!rowEl) return
      const index = Number(rowEl.dataset.trtIndex)
      const current = propsRef.current
      current.onNodeDoubleClick?.(makeMeta(index), event)
      if (event.defaultPrevented) return
      if (
        (current.toggleOnDoubleClick ?? true) &&
        !current.expandOnRowClick &&
        store.childCount(index) > 0
      ) {
        setExpandedAt(index, store.expanded[index] !== 1, false)
      }
    },
    [store, makeMeta, setExpandedAt],
  )

  const onContextMenuHandler = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const rowEl = (event.target as HTMLElement).closest('[data-trt-index]') as HTMLElement | null
      if (!rowEl) return
      const index = Number(rowEl.dataset.trtIndex)
      const current = propsRef.current
      const meta = makeMeta(index)
      current.onNodeContextMenu?.(meta, event)
      if (event.defaultPrevented || !current.contextMenu) return

      event.preventDefault()
      setActiveIndex(index)
      const ctx: TreeMenuContext<T> = {
        node: meta.node,
        nodeId: meta.id,
        meta,
        api: apiRef.current as TreeApi<T>,
        event,
      }
      const items =
        typeof current.contextMenu === 'function' ? current.contextMenu(ctx) : current.contextMenu
      if (!items || items.length === 0) return
      setMenu({ x: event.clientX, y: event.clientY, items, ctx })
    },
    [makeMeta, setActiveIndex],
  )

  /**
   * Mirrors `hoverIndex` so the handlers can compare against it without a state
   * updater: React runs updaters during the render phase, and `onHoverChange`
   * is the consumer's callback — calling it from in there would set their state
   * mid-render.
   */
  const hoverIndexRef = useRef(-1)

  const setHoverIndexAt = useCallback(
    (index: number) => {
      if (hoverIndexRef.current === index) return
      hoverIndexRef.current = index
      store.hoverIndex = index
      setHoverIndex(index)
      propsRef.current.onHoverChange?.(index >= 0 ? makeMeta(index) : null)
    },
    [store, makeMeta],
  )

  const onMouseOver = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!highlightChildrenOnHover && !propsRef.current.onHoverChange) return
      const rowEl = (event.target as HTMLElement).closest('[data-trt-index]') as HTMLElement | null
      setHoverIndexAt(rowEl ? Number(rowEl.dataset.trtIndex) : -1)
    },
    [highlightChildrenOnHover, setHoverIndexAt],
  )

  const onMouseLeave = useCallback(() => setHoverIndexAt(-1), [setHoverIndexAt])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      store.ensureVisible()
      if (store.visibleCount === 0) return
      const currentRow = store.activeIndex >= 0 ? store.visibleIndexOf(store.activeIndex) : -1

      const moveTo = (visibleIndex: number) => {
        const clamped = Math.max(0, Math.min(store.visibleCount - 1, visibleIndex))
        setActiveIndex(store.visible[clamped])
        scrollToIndex(clamped)
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveTo(currentRow + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveTo(currentRow <= 0 ? 0 : currentRow - 1)
          break
        case 'Home':
          event.preventDefault()
          moveTo(0)
          break
        case 'End':
          event.preventDefault()
          moveTo(store.visibleCount - 1)
          break
        case 'PageDown': {
          event.preventDefault()
          // A viewport worth of rows, keeping the last one as context. Rows can
          // differ in height, so the step is measured in px, not in rows.
          const from = Math.max(0, currentRow)
          const page = Math.max(rowHeight, viewportHeight - rowHeight)
          const target = layoutRef.current.rowAt(layoutRef.current.topOf(from) + page)
          moveTo(target > from ? target : from + 1)
          break
        }
        case 'PageUp': {
          event.preventDefault()
          const from = Math.max(0, currentRow)
          const page = Math.max(rowHeight, viewportHeight - rowHeight)
          const target = layoutRef.current.rowAt(layoutRef.current.topOf(from) - page)
          moveTo(target < from ? target : from - 1)
          break
        }
        case 'ArrowRight': {
          event.preventDefault()
          const index = store.activeIndex
          if (index < 0) return
          if (store.childCount(index) > 0 && store.expanded[index] !== 1) {
            setExpandedAt(index, true, event.altKey)
          } else if (store.childCount(index) > 0) {
            moveTo(currentRow + 1)
          }
          break
        }
        case 'ArrowLeft': {
          event.preventDefault()
          const index = store.activeIndex
          if (index < 0) return
          if (store.childCount(index) > 0 && store.expanded[index] === 1) {
            setExpandedAt(index, false, event.altKey)
          } else if (model.parent[index] >= 0) {
            setActiveIndex(model.parent[index])
            scrollToIndex(store.visibleIndexOf(model.parent[index]))
          }
          break
        }
        case ' ':
          event.preventDefault()
          if (store.activeIndex >= 0) toggleCheckAt(store.activeIndex)
          break
        case 'Enter': {
          event.preventDefault()
          const index = store.activeIndex
          if (index >= 0 && store.childCount(index) > 0) {
            setExpandedAt(index, store.expanded[index] !== 1, false)
          }
          break
        }
        default:
          break
      }
    },
    [
      store,
      model,
      rowHeight,
      viewportHeight,
      scrollToIndex,
      setActiveIndex,
      setExpandedAt,
      toggleCheckAt,
    ],
  )

  // ----------------------------------------------------------------- rendering

  const rows: ReactElement[] = []
  const highlightRoot = highlightChildrenOnHover ? hoverIndex : -1
  for (let row = start; row < end; row++) {
    const index = store.visible[row]
    const meta = makeMeta(index)
    // The hovered row and its direct children only — a deep subtree lighting up
    // whole screens at a time reads as noise, not as structure.
    meta.highlighted =
      highlightRoot >= 0 && (index === highlightRoot || model.parent[index] === highlightRoot)
    const custom = props.rowClassName?.(meta)
    const rowClass = index === highlightRoot ? 'trt-row--hover-root' : undefined
    rows.push(
      <TreeRow
        key={meta.id}
        meta={meta}
        top={layout.topOf(row)}
        rowHeight={rowHeight}
        wrap={wrapLabels}
        indent={indent}
        showCheckbox={showCheckboxes}
        showDeepButtons={showDeepButtons}
        showBadge={showSelectedBadge}
        className={custom && rowClass ? custom + ' ' + rowClass : (custom ?? rowClass)}
        renderLabel={props.renderLabel}
        renderIcon={props.renderIcon}
        renderTrailing={props.renderTrailing}
        renderBadge={props.renderBadge}
      />,
    )
  }

  const rootClass =
    'trt-root' + (wrapLabels ? '' : ' trt-root--nowrap') + (className ? ' ' + className : '')
  // `--trt-row-h` lets the CSS keep the caret, the checkbox and the icons on the
  // first line of a row that wrapped onto several.
  const rootStyle = { height, width, '--trt-row-h': `${rowHeight}px`, ...style } as CSSProperties

  return (
    <div
      ref={viewportRef}
      className={rootClass}
      style={rootStyle}
      role="tree"
      aria-label={ariaLabel}
      aria-rowcount={total}
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenuHandler}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      onKeyDown={onKeyDown}
    >
      <div ref={canvasRef} className="trt-canvas" style={{ height: layout.totalHeight }}>
        {rows}
      </div>
      {menu ? (
        <ContextMenu
          items={menu.items}
          x={menu.x}
          y={menu.y}
          ctx={menu.ctx}
          className={contextMenuClassName}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

export const TreeView = forwardRef(TreeViewInner) as <T = unknown>(
  props: TreeViewProps<T> & { ref?: ForwardedRef<TreeApi<T>> },
) => ReactElement
