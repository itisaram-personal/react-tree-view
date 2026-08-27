import type { CSSProperties, MouseEvent, ReactNode } from 'react'

export type TreeNodeId = string | number

/** A node as provided by the consumer. Children are optional; leaves omit them. */
export interface TreeNodeSource<T = unknown> {
  id: TreeNodeId
  /** Default label content. Overridden by `renderLabel` when provided. */
  label?: ReactNode
  children?: TreeNodeSource<T>[]
  /** Disabled nodes cannot be checked and are skipped by bulk (deep) check operations. */
  disabled?: boolean
  /** Arbitrary payload, handed back to render props / menu handlers. */
  data?: T
}

/** 0 = unchecked, 1 = checked, 2 = indeterminate. */
export const Check = {
  Off: 0,
  On: 1,
  Partial: 2,
} as const

export type CheckState = 0 | 1 | 2

/**
 * `cascade` — the classic tree checkbox: checking a node fills its subtree and
 * parents roll up to checked / indeterminate / unchecked.
 * `independent` — every node owns its check state; nothing cascades and nothing
 * is derived. Selections hidden inside a collapsed branch surface as a badge
 * on the ancestors instead of as an indeterminate box.
 */
export type SelectionMode = 'cascade' | 'independent'

/** Everything a row knows about itself. Passed to `renderLabel` and menu handlers. */
export interface TreeNodeMeta<T = unknown> {
  node: TreeNodeSource<T>
  id: TreeNodeId
  /** Stable index in the flattened (depth-first) model. */
  index: number
  depth: number
  parentId: TreeNodeId | null
  childCount: number
  /** Number of descendants at every level below this node. */
  descendantCount: number
  hasChildren: boolean
  expanded: boolean
  checkState: CheckState
  /** Checked nodes strictly below this one — what the badge shows. */
  selectedDescendantCount: number
  disabled: boolean
  /** True for the hovered node and every visible descendant of it. */
  highlighted: boolean
  /** True for the keyboard-focused row. */
  active: boolean
}

export interface TreeMenuContext<T = unknown> {
  node: TreeNodeSource<T>
  nodeId: TreeNodeId
  meta: TreeNodeMeta<T>
  api: TreeApi<T>
  event: MouseEvent | null
}

export interface TreeMenuItem<T = unknown> {
  id: string
  label?: ReactNode
  /**
   * Plain-text form of the label, used by the submenu filter box. Falls back to
   * `label` when that is a string.
   */
  text?: string
  /**
   * Nested items. A function is called when the submenu opens, so a list of
   * thousands of children costs nothing until someone asks for it. Items with a
   * submenu open it instead of firing `onSelect`.
   */
  submenu?: TreeMenuItem<T>[] | ((ctx: TreeMenuContext<T>) => TreeMenuItem<T>[])
  icon?: ReactNode
  shortcut?: ReactNode
  disabled?: boolean | ((ctx: TreeMenuContext<T>) => boolean)
  danger?: boolean
  /** Renders a divider; all other fields are ignored. */
  separator?: boolean
  onSelect?: (ctx: TreeMenuContext<T>) => void
}

export type TreeMenuItems<T = unknown> =
  TreeMenuItem<T>[] | ((ctx: TreeMenuContext<T>) => TreeMenuItem<T>[])

export interface CheckedIdsOptions {
  /**
   * `all` (default) every checked node, `leaves` only checked leaf nodes,
   * `shallow` topmost checked nodes (descendants of a checked node are
   * omitted) — cascade mode only, it falls back to `all` when states are
   * independent, since there a checked node says nothing about its children.
   */
  mode?: 'all' | 'leaves' | 'shallow'
  /** Include indeterminate nodes in the result. Default false. */
  includeIndeterminate?: boolean
}

export interface CheckOptions {
  /**
   * Apply to the whole subtree. Default true in cascade mode, false in
   * independent mode, matching what a click on the checkbox does.
   */
  deep?: boolean
  /** Suppress `onCheckChange` for this call. Default false. */
  silent?: boolean
}

export interface ExpandOptions {
  /** Apply to the whole subtree. Default false. */
  deep?: boolean
  silent?: boolean
}

export type ScrollAlign = 'auto' | 'start' | 'center' | 'end'

/** Imperative handle exposed through `ref`, and to context-menu handlers. */
export interface TreeApi<T = unknown> {
  check(ids: TreeNodeId | TreeNodeId[], options?: CheckOptions): void
  uncheck(ids: TreeNodeId | TreeNodeId[], options?: CheckOptions): void
  setChecked(ids: TreeNodeId | TreeNodeId[], checked: boolean, options?: CheckOptions): void
  toggleCheck(id: TreeNodeId, options?: CheckOptions): void
  checkAll(): void
  uncheckAll(): void
  getCheckState(id: TreeNodeId): CheckState | undefined
  getCheckedIds(options?: CheckedIdsOptions): TreeNodeId[]
  getCheckedNodes(options?: CheckedIdsOptions): TreeNodeSource<T>[]
  /** Checked nodes strictly below `id`, at any depth. */
  getSelectedDescendantCount(id: TreeNodeId): number

  expand(ids: TreeNodeId | TreeNodeId[], options?: ExpandOptions): void
  collapse(ids: TreeNodeId | TreeNodeId[], options?: ExpandOptions): void
  toggleExpand(id: TreeNodeId, options?: ExpandOptions): void
  expandAll(): void
  collapseAll(): void
  expandToLevel(level: number): void
  /** Expands every ancestor so the node becomes visible. */
  reveal(id: TreeNodeId): void
  isExpanded(id: TreeNodeId): boolean
  getExpandedIds(): TreeNodeId[]

  scrollToNode(id: TreeNodeId, align?: ScrollAlign): void
  scrollToIndex(visibleIndex: number, align?: ScrollAlign): void
  setActive(id: TreeNodeId | null): void
  getActiveId(): TreeNodeId | null
  focus(): void

  getNode(id: TreeNodeId): TreeNodeSource<T> | undefined
  getMeta(id: TreeNodeId): TreeNodeMeta<T> | undefined
  getParentId(id: TreeNodeId): TreeNodeId | null
  getChildIds(id: TreeNodeId): TreeNodeId[]
  getPath(id: TreeNodeId): TreeNodeId[]
  getNodeCount(): number
  getVisibleCount(): number
  getVisibleIds(): TreeNodeId[]
}

export interface CheckChangeEvent<T = unknown> {
  /** The node the user acted on, or null for `checkAll` / `uncheckAll`. */
  node: TreeNodeSource<T> | null
  nodeId: TreeNodeId | null
  checkState: CheckState
  api: TreeApi<T>
  /** Lazily walks the model; call only when you need the full list. */
  getCheckedIds: (options?: CheckedIdsOptions) => TreeNodeId[]
}

export interface ExpandChangeEvent<T = unknown> {
  node: TreeNodeSource<T> | null
  nodeId: TreeNodeId | null
  expanded: boolean
  deep: boolean
  api: TreeApi<T>
}

export interface TreeViewProps<T = unknown> {
  data: TreeNodeSource<T>[]
  /** Fixed row height in px. Uniform heights are what keep virtualization O(1). */
  rowHeight?: number
  /** Extra rows rendered above/below the viewport. Default 8. */
  overscan?: number
  /** Horizontal px added per depth level. Default 18. */
  indent?: number
  height?: number | string
  width?: number | string
  className?: string
  style?: CSSProperties

  defaultCheckedIds?: TreeNodeId[]
  defaultExpandedIds?: TreeNodeId[]
  /** Expand everything down to this depth on mount (0 = roots only). */
  defaultExpandLevel?: number
  /** Expand every node on mount. Overrides `defaultExpandLevel`. */
  defaultExpandAll?: boolean

  /** How checkboxes behave. Default `cascade`. */
  selectionMode?: SelectionMode
  showCheckboxes?: boolean
  /**
   * Show the "n selected inside" badge on nodes with checked descendants.
   * Defaults to true in independent mode, false in cascade mode (where an
   * indeterminate box already says it).
   */
  showSelectedBadge?: boolean
  /** Replaces the default badge. Only called when the count is above zero. */
  renderBadge?: (count: number, meta: TreeNodeMeta<T>) => ReactNode
  /** Show the per-row deep expand / deep collapse buttons. Default true. */
  showDeepButtons?: boolean
  /** Highlight the hovered node together with its visible subtree. Default true. */
  highlightSubtreeOnHover?: boolean
  /** Clicking a row label toggles its check state. Default false. */
  checkOnRowClick?: boolean
  /** Clicking a row label toggles expansion. Default false. */
  expandOnRowClick?: boolean
  /** Double-clicking a row toggles expansion. Default true. */
  toggleOnDoubleClick?: boolean

  renderLabel?: (meta: TreeNodeMeta<T>) => ReactNode
  /** Rendered between the deep buttons and the checkbox (icons, badges…). */
  renderIcon?: (meta: TreeNodeMeta<T>) => ReactNode
  /** Rendered at the end of the row. */
  renderTrailing?: (meta: TreeNodeMeta<T>) => ReactNode
  rowClassName?: (meta: TreeNodeMeta<T>) => string | undefined

  contextMenu?: TreeMenuItems<T>
  contextMenuClassName?: string

  onCheckChange?: (event: CheckChangeEvent<T>) => void
  onExpandChange?: (event: ExpandChangeEvent<T>) => void
  onNodeClick?: (meta: TreeNodeMeta<T>, event: MouseEvent) => void
  onNodeDoubleClick?: (meta: TreeNodeMeta<T>, event: MouseEvent) => void
  onNodeContextMenu?: (meta: TreeNodeMeta<T>, event: MouseEvent) => void
  onActiveChange?: (meta: TreeNodeMeta<T> | null) => void
  onHoverChange?: (meta: TreeNodeMeta<T> | null) => void
  /** Called after the visible window changes. Handy for lazy loading. */
  onVisibleRangeChange?: (start: number, end: number) => void

  /** Accessible name for the tree. */
  ariaLabel?: string
}
