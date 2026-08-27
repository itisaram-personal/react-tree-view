import type { TreeNodeId, TreeNodeSource } from './types'

/**
 * Depth-first flattening of the source tree into parallel typed arrays.
 *
 * The DFS ordering is the load-bearing part of the whole package: the
 * descendants of node `i` always occupy the contiguous range
 * `[i + 1, i + descendantCount[i]]`. Subtree checks, deep expand/collapse and
 * "is this row inside the hovered subtree" therefore become range operations
 * instead of graph walks.
 */
export interface FlatModel<T = unknown> {
  size: number
  nodes: TreeNodeSource<T>[]
  ids: TreeNodeId[]
  idToIndex: Map<TreeNodeId, number>
  /** Parent index, -1 for roots. */
  parent: Int32Array
  depth: Int32Array
  /** Number of descendants (all levels), excluding the node itself. */
  descendants: Int32Array
  /** CSR offsets into `childIndex`; node i owns [childStart[i], childStart[i + 1]). */
  childStart: Int32Array
  childIndex: Int32Array
  disabled: Uint8Array
  maxDepth: number
}

const EMPTY_CHILDREN: TreeNodeSource<never>[] = []

function countNodes<T>(nodes: TreeNodeSource<T>[]): number {
  let total = 0
  const stack: TreeNodeSource<T>[][] = [nodes]
  while (stack.length > 0) {
    const list = stack.pop()!
    total += list.length
    for (let i = 0; i < list.length; i++) {
      const children = list[i].children
      if (children !== undefined && children.length > 0) stack.push(children)
    }
  }
  return total
}

/** Builds the flat model. Iterative on purpose: deep trees must not blow the stack. */
export function buildModel<T>(data: TreeNodeSource<T>[]): FlatModel<T> {
  const total = countNodes(data)

  const nodes = new Array<TreeNodeSource<T>>(total)
  const ids = new Array<TreeNodeId>(total)
  const idToIndex = new Map<TreeNodeId, number>()
  const parent = new Int32Array(total)
  const depth = new Int32Array(total)
  const descendants = new Int32Array(total)
  const childCount = new Int32Array(total)
  const disabled = new Uint8Array(total)

  // Explicit DFS: each frame is a sibling list plus the cursor into it.
  const listStack: TreeNodeSource<T>[][] = [data]
  const posStack: number[] = [0]
  const parentStack: number[] = [-1]
  let cursor = 0
  let maxDepth = 0

  while (listStack.length > 0) {
    const top = listStack.length - 1
    const list = listStack[top]
    const pos = posStack[top]
    if (pos >= list.length) {
      listStack.pop()
      posStack.pop()
      parentStack.pop()
      continue
    }
    posStack[top] = pos + 1

    const node = list[pos]
    const index = cursor++
    const parentIndex = parentStack[top]
    const level = top

    nodes[index] = node
    ids[index] = node.id
    parent[index] = parentIndex
    depth[index] = level
    if (node.disabled === true) disabled[index] = 1
    if (level > maxDepth) maxDepth = level
    if (parentIndex >= 0) childCount[parentIndex]++
    if (idToIndex.has(node.id)) {
      // Duplicate ids break id-based lookups; first one wins, but say so loudly.
      if (typeof console !== 'undefined') {
        console.warn(`[react-tree-view] duplicate node id: ${String(node.id)}`)
      }
    } else {
      idToIndex.set(node.id, index)
    }

    const children = node.children ?? (EMPTY_CHILDREN as TreeNodeSource<T>[])
    if (children.length > 0) {
      listStack.push(children)
      posStack.push(0)
      parentStack.push(index)
    }
  }

  // Descendant counts: in DFS order every descendant has a higher index than its
  // ancestor, so a single backward sweep is enough.
  for (let i = total - 1; i > 0; i--) {
    const p = parent[i]
    if (p >= 0) descendants[p] += descendants[i] + 1
  }

  // CSR child index (children stay in source order because DFS emits them in order).
  const childStart = new Int32Array(total + 1)
  for (let i = 0; i < total; i++) childStart[i + 1] = childStart[i] + childCount[i]
  const childIndex = new Int32Array(total)
  const fill = new Int32Array(total)
  for (let i = 0; i < total; i++) {
    const p = parent[i]
    if (p >= 0) childIndex[childStart[p] + fill[p]++] = i
  }

  return {
    size: total,
    nodes,
    ids,
    idToIndex,
    parent,
    depth,
    descendants,
    childStart,
    childIndex,
    disabled,
    maxDepth,
  }
}

export function childCountOf(model: FlatModel, index: number): number {
  return model.childStart[index + 1] - model.childStart[index]
}
