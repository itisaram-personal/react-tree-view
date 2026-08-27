import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TreeMenuContext, TreeMenuItem } from './types'

/** Must match the height of `.trt-menu-item` in styles.css. */
const ITEM_HEIGHT = 28
const MAX_LIST_HEIGHT = 320
/** Above this many entries the list is windowed instead of fully rendered. */
const VIRTUALIZE_ABOVE = 40
/** Above this many entries a filter box appears. */
const FILTER_ABOVE = 12
const OVERSCAN = 4
const EDGE = 6

export interface ContextMenuProps<T> {
  items: TreeMenuItem<T>[]
  x: number
  y: number
  ctx: TreeMenuContext<T>
  className?: string
  onClose: () => void
}

function itemText<T>(item: TreeMenuItem<T>): string {
  if (item.text !== undefined) return item.text
  return typeof item.label === 'string' || typeof item.label === 'number' ? String(item.label) : ''
}

function resolveSubmenu<T>(item: TreeMenuItem<T>, ctx: TreeMenuContext<T>): TreeMenuItem<T>[] {
  const { submenu } = item
  if (!submenu) return []
  return typeof submenu === 'function' ? submenu(ctx) : submenu
}

interface PanelProps<T> {
  items: TreeMenuItem<T>[]
  ctx: TreeMenuContext<T>
  /** Anchor. A root panel opens at the cursor, a submenu next to its parent row. */
  x: number
  y: number
  /** Right edge of the parent item, so a flipped submenu can open leftwards. */
  anchorLeft?: number
  className?: string
  isRoot: boolean
  /** Closes the whole menu tree. */
  onClose: () => void
  /** Closes this panel only and hands focus back to the parent panel. */
  onCloseSelf: () => void
}

interface OpenSub<T> {
  index: number
  items: TreeMenuItem<T>[]
  x: number
  y: number
  anchorLeft: number
}

/**
 * One menu surface. Long lists (a node with thousands of children) get a filter
 * box and a windowed list, so opening the menu costs the same at 5 or 5000
 * entries. Submenus are panels of their own, portaled next to their parent row.
 */
function MenuPanel<T>(props: PanelProps<T>) {
  const { items, ctx, x, y, anchorLeft, className, isRoot, onClose, onCloseSelf } = props
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })
  const [activeIndex, setActiveIndex] = useState(-1)
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [sub, setSub] = useState<OpenSub<T> | null>(null)

  const showFilter = items.length > FILTER_ABOVE

  const shown = useMemo(() => {
    if (!query) return items
    const needle = query.toLowerCase()
    return items.filter((item) => !item.separator && itemText(item).toLowerCase().includes(needle))
  }, [items, query])

  const virtualize = shown.length > VIRTUALIZE_ABOVE
  const listHeight = Math.min(MAX_LIST_HEIGHT, Math.max(ITEM_HEIGHT, shown.length * ITEM_HEIGHT))

  const isDisabled = useCallback(
    (item: TreeMenuItem<T>): boolean =>
      typeof item.disabled === 'function' ? item.disabled(ctx) : item.disabled === true,
    [ctx],
  )

  // ------------------------------------------------------------- positioning

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + width + EDGE > window.innerWidth) {
      // Root menus flip around the cursor, submenus around their parent panel.
      left = Math.max(EDGE, (anchorLeft ?? x) - width)
    }
    if (top + height + EDGE > window.innerHeight)
      top = Math.max(EDGE, window.innerHeight - height - EDGE)
    setPos({ left, top, ready: true })
    el.focus({ preventScroll: true })
  }, [x, y, anchorLeft])

  // ------------------------------------------------------------ global close

  useEffect(() => {
    if (!isRoot) return
    const insideMenu = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      target instanceof Element &&
      target.closest('[data-trt-menu]') !== null
    const onPointerDown = (event: PointerEvent) => {
      if (!insideMenu(event.target)) onClose()
    }
    const onWheel = (event: WheelEvent) => {
      // Menus scroll internally now, so only scrolling *outside* dismisses.
      if (!insideMenu(event.target)) onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [isRoot, onClose])

  // --------------------------------------------------------------- behaviour

  const closeSub = useCallback(() => {
    setSub(null)
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  const rowRect = (index: number): DOMRect | null => {
    const el = panelRef.current?.querySelector(`[data-trt-menu-item="${index}"]`)
    return el ? el.getBoundingClientRect() : null
  }

  /** The new panel focuses itself on mount, so opening is all this does. */
  const openSub = useCallback(
    (index: number) => {
      const item = shown[index]
      if (!item?.submenu || isDisabled(item)) return
      const rect = rowRect(index)
      const panel = panelRef.current?.getBoundingClientRect()
      if (!rect || !panel) return
      setSub({
        index,
        items: resolveSubmenu(item, ctx),
        x: panel.right - 2,
        y: rect.top - 4,
        anchorLeft: panel.left,
      })
    },
    [shown, ctx, isDisabled],
  )

  const run = useCallback(
    (item: TreeMenuItem<T>) => {
      if (isDisabled(item)) return
      if (item.submenu) return // parents open, they do not fire
      onClose()
      item.onSelect?.(ctx)
    },
    [ctx, isDisabled, onClose],
  )

  const scrollItemIntoView = (index: number) => {
    const list = listRef.current
    if (!list) return
    const top = index * ITEM_HEIGHT
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + ITEM_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight + ITEM_HEIGHT
    }
  }

  const move = (delta: number) => {
    if (shown.length === 0) return
    let next = activeIndex
    for (let step = 0; step < shown.length; step++) {
      next = (next + delta + shown.length) % shown.length
      const candidate = shown[next]
      if (!candidate.separator && !isDisabled(candidate)) break
    }
    setActiveIndex(next)
    scrollItemIntoView(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (sub) return // the open submenu owns the keyboard
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(-1)
        move(1)
        break
      case 'ArrowRight':
        if (shown[activeIndex]?.submenu) {
          event.preventDefault()
          openSub(activeIndex)
        }
        break
      case 'ArrowLeft':
        if (!isRoot) {
          event.preventDefault()
          onCloseSelf()
        }
        break
      case 'Escape':
        event.preventDefault()
        if (isRoot) onClose()
        else onCloseSelf()
        break
      case 'Enter':
      case ' ': {
        const item = shown[activeIndex]
        if (!item) break
        event.preventDefault()
        if (item.submenu) openSub(activeIndex)
        else run(item)
        break
      }
      default:
        break
    }
  }

  // ----------------------------------------------------------------- render

  const start = virtualize ? Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN) : 0
  const end = virtualize
    ? Math.min(shown.length, Math.ceil((scrollTop + listHeight) / ITEM_HEIGHT) + OVERSCAN)
    : shown.length

  const renderItem = (item: TreeMenuItem<T>, index: number) => {
    if (item.separator) {
      return (
        <div
          key={item.id || `sep-${index}`}
          className="trt-menu-sep"
          role="separator"
          style={
            virtualize
              ? {
                  position: 'absolute',
                  top: index * ITEM_HEIGHT + ITEM_HEIGHT / 2,
                  left: 0,
                  right: 0,
                }
              : undefined
          }
        />
      )
    }
    const disabled = isDisabled(item)
    const hasSub = Boolean(item.submenu)
    return (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        data-trt-menu-item={index}
        className={
          'trt-menu-item' +
          (item.danger ? ' trt-menu-item--danger' : '') +
          (index === activeIndex ? ' trt-menu-item--active' : '')
        }
        style={
          virtualize
            ? { position: 'absolute', top: index * ITEM_HEIGHT, left: 0, right: 0 }
            : undefined
        }
        disabled={disabled}
        aria-haspopup={hasSub || undefined}
        aria-expanded={hasSub ? sub?.index === index : undefined}
        onMouseEnter={() => {
          setActiveIndex(index)
          if (hasSub) {
            if (sub?.index !== index) openSub(index)
          } else if (sub) {
            setSub(null)
          }
        }}
        onClick={() => (hasSub ? openSub(index) : run(item))}
      >
        <span className="trt-menu-icon">{item.icon}</span>
        <span className="trt-menu-label">{item.label}</span>
        {item.shortcut ? <span className="trt-menu-shortcut">{item.shortcut}</span> : null}
        {hasSub ? <span className="trt-menu-arrow" aria-hidden="true" /> : null}
      </button>
    )
  }

  const rows = []
  for (let i = start; i < end; i++) rows.push(renderItem(shown[i], i))

  return (
    <>
      <div
        ref={panelRef}
        data-trt-menu=""
        className={'trt-menu' + (className ? ' ' + className : '')}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        role="menu"
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      >
        {showFilter ? (
          <div className="trt-menu-filter">
            <input
              value={query}
              placeholder={`Filter items...`}
              aria-label="Filter menu items"
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(-1)
                setScrollTop(0)
                if (listRef.current) listRef.current.scrollTop = 0
              }}
              onKeyDown={(event) => {
                // Let the panel handle navigation keys, keep the rest for typing.
                if (
                  event.key.startsWith('Arrow') ||
                  event.key === 'Enter' ||
                  event.key === 'Escape'
                ) {
                  return
                }
                event.stopPropagation()
              }}
            />
          </div>
        ) : null}

        <div
          ref={listRef}
          className="trt-menu-list"
          style={{ maxHeight: MAX_LIST_HEIGHT, height: virtualize ? listHeight : undefined }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {virtualize ? (
            <div style={{ position: 'relative', height: shown.length * ITEM_HEIGHT }}>{rows}</div>
          ) : (
            rows
          )}
        </div>

        {query && shown.length === 0 ? <div className="trt-menu-empty">No matches</div> : null}
      </div>

      {sub ? (
        <MenuPanel
          items={sub.items}
          ctx={ctx}
          x={sub.x}
          y={sub.y}
          anchorLeft={sub.anchorLeft}
          className={className}
          isRoot={false}
          onClose={onClose}
          onCloseSelf={closeSub}
        />
      ) : null}
    </>
  )
}

/**
 * Portal-rendered menu. Closes on outside pointer down, Escape, outside scroll
 * or resize, and keeps every panel inside the viewport by flipping its anchor.
 */
export function ContextMenu<T>({ items, x, y, ctx, className, onClose }: ContextMenuProps<T>) {
  return createPortal(
    <MenuPanel
      items={items}
      ctx={ctx}
      x={x}
      y={y}
      className={className}
      isRoot
      onClose={onClose}
      onCloseSelf={onClose}
    />,
    document.body,
  )
}
