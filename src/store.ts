import { buildModel, childCountOf, type FlatModel } from './model'
import type {
  CheckState,
  CheckedIdsOptions,
  SelectionMode,
  TreeNodeId,
  TreeNodeSource,
} from './types'

const OFF: CheckState = 0
const ON: CheckState = 1
const PARTIAL: CheckState = 2

export interface TreeStoreInit {
  checkedIds?: TreeNodeId[]
  expandedIds?: TreeNodeId[]
  expandLevel?: number
  expandAll?: boolean
  /**
   * `cascade` (default): a parent's state is derived from its children, so it
   * can be indeterminate. `independent`: every node owns its state, nothing is
   * derived, and `selectedInside` feeds the "n selected below" badge.
   */
  selectionMode?: SelectionMode
}

/**
 * Owns all mutable tree state in flat typed arrays and notifies React through
 * `useSyncExternalStore`. Nothing here allocates per node during interaction:
 * every operation is a range fill plus an O(depth) walk up to the root.
 */
export class TreeStore<T = unknown> {
  readonly model: FlatModel<T>
  readonly selectionMode: SelectionMode

  /** 0 unchecked / 1 checked / 2 indeterminate, one slot per node. */
  readonly checkState: Uint8Array
  /** Checked / indeterminate direct-child tallies, so parents derive in O(1). */
  private readonly checkedChildren: Int32Array
  private readonly partialChildren: Int32Array
  /** Number of checked nodes strictly below each node — the badge count. */
  readonly selectedInside: Int32Array
  readonly expanded: Uint8Array

  /** Node indices currently rendered, in DFS order. */
  visible: Int32Array
  visibleCount = 0

  activeIndex = -1
  hoverIndex = -1

  private version = 0
  private listeners = new Set<() => void>()
  private visibleDirty = true

  constructor(data: TreeNodeSource<T>[], init: TreeStoreInit = {}, previous?: TreeStore<T>) {
    this.model = buildModel(data)
    this.selectionMode = init.selectionMode ?? 'cascade'
    const n = this.model.size
    this.checkState = new Uint8Array(n)
    this.checkedChildren = new Int32Array(n)
    this.partialChildren = new Int32Array(n)
    this.selectedInside = new Int32Array(n)
    this.expanded = new Uint8Array(n)
    this.visible = new Int32Array(n)

    if (previous) this.adoptState(previous)
    else this.applyInit(init)
    this.markVisibleDirty()
  }

  get cascades(): boolean {
    return this.selectionMode === 'cascade'
  }

  // ---------------------------------------------------------------- lifecycle

  private applyInit(init: TreeStoreInit): void {
    const { model } = this
    if (init.expandAll) {
      this.expanded.fill(1)
    } else if (init.expandLevel !== undefined && init.expandLevel >= 0) {
      for (let i = 0; i < model.size; i++) {
        if (model.depth[i] <= init.expandLevel) this.expanded[i] = 1
      }
    }
    if (init.expandedIds) {
      for (const id of init.expandedIds) {
        const i = model.idToIndex.get(id)
        if (i !== undefined) this.expanded[i] = 1
      }
    }
    if (init.checkedIds && init.checkedIds.length > 0) {
      for (const id of init.checkedIds) {
        const i = model.idToIndex.get(id)
        if (i === undefined || model.disabled[i] === 1) continue
        // Cascade fills each subtree; independent mode takes the ids literally.
        if (this.cascades) this.setSubtreeCheck(i, ON, true)
        else this.checkState[i] = ON
      }
      if (!this.cascades) this.rebuildDerived()
    }
  }

  /**
   * Carries check/expand state across a `data` (or selection mode) change,
   * matching by id. Explicit state is copied; everything derived is rebuilt, so
   * added or removed children cannot leave a stale parent behind.
   */
  private adoptState(previous: TreeStore<T>): void {
    const { model } = this
    const prev = previous.model
    const copyParents = !this.cascades
    for (let i = 0; i < model.size; i++) {
      const old = prev.idToIndex.get(model.ids[i])
      if (old === undefined) continue
      this.expanded[i] = previous.expanded[old]
      if (copyParents || childCountOf(model, i) === 0) {
        // A parent that was indeterminate has no explicit state to carry.
        const state = previous.checkState[old]
        this.checkState[i] = state === PARTIAL && copyParents ? OFF : state
      }
    }
    this.rebuildDerived()
    const activeId = previous.activeIndex >= 0 ? prev.ids[previous.activeIndex] : undefined
    if (activeId !== undefined) this.activeIndex = model.idToIndex.get(activeId) ?? -1
  }

  // ------------------------------------------------------------- subscription

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion = (): number => this.version

  emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  // ------------------------------------------------------------------ lookups

  indexOf(id: TreeNodeId): number {
    const i = this.model.idToIndex.get(id)
    return i === undefined ? -1 : i
  }

  idAt(index: number): TreeNodeId | null {
    return index >= 0 && index < this.model.size ? this.model.ids[index] : null
  }

  childCount(index: number): number {
    return childCountOf(this.model, index)
  }

  lastDescendant(index: number): number {
    return index + this.model.descendants[index]
  }

  /** True when `index` is `root` itself or lives inside its subtree. */
  isInSubtree(root: number, index: number): boolean {
    return root >= 0 && index >= root && index <= root + this.model.descendants[root]
  }

  // ------------------------------------------------------------------- checks

  private deriveState(index: number): CheckState {
    if (!this.cascades) return this.checkState[index] as CheckState
    const total = this.childCount(index)
    if (total === 0) return this.checkState[index] as CheckState
    const checked = this.checkedChildren[index]
    if (checked === total) return ON
    if (checked === 0 && this.partialChildren[index] === 0) return OFF
    return PARTIAL
  }

  /** Recomputes one node's tallies (and, in cascade mode, its state). */
  private recomputeNode(index: number): void {
    const { model } = this
    const start = model.childStart[index]
    const end = model.childStart[index + 1]
    let checked = 0
    let partial = 0
    let inside = 0
    for (let k = start; k < end; k++) {
      const child = model.childIndex[k]
      const state = this.checkState[child]
      if (state === ON) {
        checked++
        inside++
      } else if (state === PARTIAL) {
        partial++
      }
      inside += this.selectedInside[child]
    }
    this.checkedChildren[index] = checked
    this.partialChildren[index] = partial
    this.selectedInside[index] = inside
    if (this.cascades && end > start) this.checkState[index] = this.deriveState(index)
  }

  /** Full bottom-up sweep. Children always sit after their parent in DFS order. */
  private rebuildDerived(): void {
    for (let i = this.model.size - 1; i >= 0; i--) this.recomputeNode(i)
  }

  /** Total checked nodes in the subtree rooted at `index`, including itself. */
  private subtreeSelected(index: number): number {
    return this.selectedInside[index] + (this.checkState[index] === ON ? 1 : 0)
  }

  /**
   * Walks to the root: always carries the badge delta all the way up, and in
   * cascade mode re-derives parents until one stops changing.
   */
  private propagateUp(
    index: number,
    oldState: CheckState,
    newState: CheckState,
    insideDelta: number,
  ): void {
    let child = index
    let previous = oldState
    let current = newState
    let stateSettled = previous === current
    let parent = this.model.parent[child]

    while (parent >= 0) {
      if (insideDelta !== 0) this.selectedInside[parent] += insideDelta

      if (!stateSettled) {
        if (previous === ON) this.checkedChildren[parent]--
        else if (previous === PARTIAL) this.partialChildren[parent]--
        if (current === ON) this.checkedChildren[parent]++
        else if (current === PARTIAL) this.partialChildren[parent]++

        const before = this.checkState[parent] as CheckState
        const after = this.deriveState(parent)
        if (this.cascades) {
          this.checkState[parent] = after
          // A derived parent that gains or loses its own check counts toward
          // the badge of everything above it.
          insideDelta += (after === ON ? 1 : 0) - (before === ON ? 1 : 0)
        }
        previous = before
        current = after
        stateSettled = before === after
      }

      if (insideDelta === 0 && stateSettled) return
      child = parent
      parent = this.model.parent[child]
    }
  }

  /**
   * Sets `index` and (when `deep`) its whole subtree, skipping disabled
   * branches, then updates every ancestor. Returns true when anything moved.
   *
   * In independent mode a shallow set touches exactly one node, whatever its
   * children hold; in cascade mode only leaves can be set on their own.
   */
  setSubtreeCheck(index: number, value: CheckState, deep = true): boolean {
    const { model } = this
    if (index < 0 || index >= model.size || model.disabled[index] === 1) return false

    const beforeState = this.checkState[index] as CheckState
    const beforeSelected = this.subtreeSelected(index)

    if (!deep || model.descendants[index] === 0) {
      if (this.cascades && this.childCount(index) > 0) return false
      if (beforeState === value) return false
      this.checkState[index] = value
    } else {
      const end = this.lastDescendant(index)
      for (let j = index; j <= end; j++) {
        if (model.disabled[j] === 1) {
          j += model.descendants[j] // leave disabled branches untouched
          continue
        }
        this.checkState[j] = value
      }
      // Bottom-up fix-up: tallies, badge counts, and (cascade) parent states.
      for (let j = end; j >= index; j--) this.recomputeNode(j)
    }

    const afterState = this.checkState[index] as CheckState
    this.propagateUp(index, beforeState, afterState, this.subtreeSelected(index) - beforeSelected)
    return true
  }

  toggleCheck(index: number, deep = true): boolean {
    const next: CheckState = this.checkState[index] === ON ? OFF : ON
    return this.setSubtreeCheck(index, next, deep)
  }

  setAllChecked(value: CheckState): void {
    const { model } = this
    for (let i = 0; i < model.size; i++) {
      if (model.disabled[i] === 1) {
        i += model.descendants[i]
        continue
      }
      this.checkState[i] = value
    }
    this.rebuildDerived()
  }

  getCheckedIds(options: CheckedIdsOptions = {}): TreeNodeId[] {
    const { includeIndeterminate = false } = options
    // "shallow" means "a checked node implies its subtree" — only true when
    // states cascade, so independent mode falls back to listing everything.
    const mode = options.mode === 'shallow' && !this.cascades ? 'all' : (options.mode ?? 'all')
    const { model } = this
    const out: TreeNodeId[] = []
    if (mode === 'shallow') {
      for (let i = 0; i < model.size;) {
        const state = this.checkState[i]
        if (state === ON) {
          out.push(model.ids[i])
          i += model.descendants[i] + 1
          continue
        }
        if (state === PARTIAL && includeIndeterminate) out.push(model.ids[i])
        i++
      }
      return out
    }
    const leavesOnly = mode === 'leaves'
    for (let i = 0; i < model.size; i++) {
      const state = this.checkState[i]
      const wanted = state === ON || (includeIndeterminate && state === PARTIAL)
      if (!wanted) continue
      if (leavesOnly && this.childCount(i) > 0) continue
      out.push(model.ids[i])
    }
    return out
  }

  // ---------------------------------------------------------------- expansion

  setExpanded(index: number, value: boolean, deep = false): boolean {
    const { model } = this
    if (index < 0 || index >= model.size) return false
    const flag = value ? 1 : 0
    let changed = false
    if (deep) {
      const end = this.lastDescendant(index)
      for (let j = index; j <= end; j++) {
        if (this.expanded[j] !== flag) {
          this.expanded[j] = flag
          changed = true
        }
      }
    } else if (this.expanded[index] !== flag) {
      this.expanded[index] = flag
      changed = true
    }
    if (changed) this.markVisibleDirty()
    return changed
  }

  setAllExpanded(value: boolean): void {
    this.expanded.fill(value ? 1 : 0)
    this.markVisibleDirty()
  }

  expandToLevel(level: number): void {
    const { model } = this
    for (let i = 0; i < model.size; i++) {
      this.expanded[i] = model.depth[i] <= level ? 1 : 0
    }
    this.markVisibleDirty()
  }

  /** Expands every ancestor of `index`. Returns true if the tree changed. */
  reveal(index: number): boolean {
    let changed = false
    let parent = this.model.parent[index]
    while (parent >= 0) {
      if (this.expanded[parent] !== 1) {
        this.expanded[parent] = 1
        changed = true
      }
      parent = this.model.parent[parent]
    }
    if (changed) this.markVisibleDirty()
    return changed
  }

  getExpandedIds(): TreeNodeId[] {
    const out: TreeNodeId[] = []
    for (let i = 0; i < this.model.size; i++) {
      if (this.expanded[i] === 1 && this.childCount(i) > 0) out.push(this.model.ids[i])
    }
    return out
  }

  // ------------------------------------------------------------------ visible

  markVisibleDirty(): void {
    this.visibleDirty = true
  }

  /** Rebuilds the list of rendered rows. Collapsed subtrees are skipped whole. */
  ensureVisible(): void {
    if (!this.visibleDirty) return
    const { model, expanded, visible } = this
    let k = 0
    for (let i = 0; i < model.size;) {
      visible[k++] = i
      if (expanded[i] === 1 && model.descendants[i] > 0) i++
      else i += model.descendants[i] + 1
    }
    this.visibleCount = k
    this.visibleDirty = false
  }

  /** Row position of a node, or -1 when it sits inside a collapsed branch. */
  visibleIndexOf(nodeIndex: number): number {
    this.ensureVisible()
    let low = 0
    let high = this.visibleCount - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const value = this.visible[mid]
      if (value === nodeIndex) return mid
      if (value < nodeIndex) low = mid + 1
      else high = mid - 1
    }
    return -1
  }
}
