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
  TreeNodeMeta,
  TreeNodeSource,
  TreeViewProps,
} from './types'

interface MenuState<T> {
  x: number
  y: number
  items: TreeMenuItem<T>[]
  ctx: TreeMenuContext<T>
}

function toArray(ids: TreeNodeId | TreeNodeId[]): TreeNodeId[] {
  return Array.isArray(ids) ? ids : [ids]
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
    showCheckboxes = true,
    showDeepButtons = true,
    highlightSubtreeOnHover = true,
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
  store.ensureVisible()

  const { model } = store
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [menu, setMenu] = useState<MenuState<T> | null>(null)

  // ------------------------------------------------------------------- viewport

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const total = store.visibleCount
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(
    total,
    Math.ceil((scrollTop + (viewportHeight || rowHeight * 20)) / rowHeight) + overscan,
  )

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
      }
    },
    [store, model],
  )

  const scrollToIndex = useCallback(
    (visibleIndex: number, align: ScrollAlign = 'auto') => {
      const el = viewportRef.current
      if (!el || visibleIndex < 0) return
      const top = visibleIndex * rowHeight
      const height = el.clientHeight
      if (align === 'start') el.scrollTop = top
      else if (align === 'end') el.scrollTop = top - height + rowHeight
      else if (align === 'center') el.scrollTop = top - height / 2 + rowHeight / 2
      else if (top < el.scrollTop) el.scrollTop = top
      else if (top + rowHeight > el.scrollTop + height) el.scrollTop = top - height + rowHeight
    },
    [rowHeight],
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

  const onMouseOver = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!highlightSubtreeOnHover && !propsRef.current.onHoverChange) return
      const rowEl = (event.target as HTMLElement).closest('[data-trt-index]') as HTMLElement | null
      const index = rowEl ? Number(rowEl.dataset.trtIndex) : -1
      setHoverIndex((previous) => {
        if (previous === index) return previous
        store.hoverIndex = index
        propsRef.current.onHoverChange?.(index >= 0 ? makeMeta(index) : null)
        return index
      })
    },
    [highlightSubtreeOnHover, store, makeMeta],
  )

  const onMouseLeave = useCallback(() => {
    setHoverIndex((previous) => {
      if (previous === -1) return previous
      store.hoverIndex = -1
      propsRef.current.onHoverChange?.(null)
      return -1
    })
  }, [store])

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
        case 'PageDown':
          event.preventDefault()
          moveTo(currentRow + Math.max(1, Math.floor(viewportHeight / rowHeight) - 1))
          break
        case 'PageUp':
          event.preventDefault()
          moveTo(currentRow - Math.max(1, Math.floor(viewportHeight / rowHeight) - 1))
          break
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
  const highlightRoot = highlightSubtreeOnHover ? hoverIndex : -1
  for (let row = start; row < end; row++) {
    const index = store.visible[row]
    const meta = makeMeta(index)
    meta.highlighted = highlightRoot >= 0 && store.isInSubtree(highlightRoot, index)
    const custom = props.rowClassName?.(meta)
    const rowClass = index === highlightRoot ? 'trt-row--hover-root' : undefined
    rows.push(
      <TreeRow
        key={meta.id}
        meta={meta}
        top={row * rowHeight}
        rowHeight={rowHeight}
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

  return (
    <div
      ref={viewportRef}
      className={'trt-root' + (className ? ' ' + className : '')}
      style={{ height, width, ...style }}
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
      <div className="trt-canvas" style={{ height: total * rowHeight }}>
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
