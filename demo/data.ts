import type { TreeNodeSource } from '../src'

export interface DemoData {
  kind: 'folder' | 'file'
  size: number
}

export type DemoNode = TreeNodeSource<DemoData>

const FOLDERS = ['services', 'domain', 'infra', 'ui', 'jobs', 'shared', 'legacy', 'tools']
const FILES = ['index', 'client', 'handler', 'mapper', 'model', 'utils', 'config', 'spec']

/**
 * Builds a synthetic tree of roughly `target` nodes with the requested depth.
 * Branching is derived from depth so the totals stay close to the preset.
 */
export function makeTree(depth: number, branching: number, target: number): DemoNode[] {
  const roots: DemoNode[] = []
  let created = 0

  const build = (level: number, path: string): DemoNode | null => {
    if (created >= target) return null
    const isLeaf = level >= depth
    const id = path
    created++
    const node: DemoNode = {
      id,
      label: isLeaf
        ? `${FILES[created % FILES.length]}-${created}.ts`
        : `${FOLDERS[created % FOLDERS.length]}-${level}-${created}`,
      data: { kind: isLeaf ? 'file' : 'folder', size: 200 + ((created * 37) % 9000) },
      // Every 97th node is disabled: bulk operations must skip these branches.
      disabled: created % 97 === 0,
    }
    if (!isLeaf) {
      const children: DemoNode[] = []
      for (let i = 0; i < branching && created < target; i++) {
        const child = build(level + 1, `${path}.${i}`)
        if (child) children.push(child)
      }
      if (children.length > 0) node.children = children
    }
    return node
  }

  for (let i = 0; created < target; i++) {
    const root = build(0, `r${i}`)
    if (!root) break
    roots.push(root)
  }
  return roots
}

/**
 * One root with a very large number of direct children — the case where the
 * "Select a sub level" submenu has to list thousands of entries.
 */
export function makeWideTree(siblings: number): DemoNode[] {
  const children: DemoNode[] = []
  for (let i = 0; i < siblings; i++) {
    children.push({
      id: `w.${i}`,
      label: `${FOLDERS[i % FOLDERS.length]}-${i}`,
      data: { kind: 'folder', size: 0 },
      children: [
        { id: `w.${i}.0`, label: `index.ts`, data: { kind: 'file', size: 1200 } },
        { id: `w.${i}.1`, label: `client.ts`, data: { kind: 'file', size: 3400 } },
        { id: `w.${i}.2`, label: `spec.ts`, data: { kind: 'file', size: 900 } },
      ],
    })
  }
  return [
    {
      id: 'w',
      label: `packages (${siblings.toLocaleString()} children)`,
      data: { kind: 'folder', size: 0 },
      children,
    },
  ]
}

// depth is number of nested levels, branching is number of branches at the last level
// target is number of total nodes in the tree wide number of items at level 2, ignored the depth and branching and target
export const PRESETS = [
  { id: 'small', label: '1K nodes nodes L3 B6 W0', depth: 3, branching: 6, target: 1_000, wide: 0 },
  {
    id: 'medium',
    label: '20K nodes nodes L5 B6 W0',
    depth: 5,
    branching: 6,
    target: 2_000,
    wide: 0,
  },
  {
    id: 'large',
    label: '100K nodes nodes L2 B100 W0',
    depth: 2,
    branching: 1000,
    target: 100_000,
    wide: 0,
  },
  {
    id: 'huge',
    label: '300K nodes L7 B500 W0',
    depth: 7,
    branching: 500,
    target: 300_000,
    wide: 0,
  },
  {
    id: 'dso',
    label: 'DSO nodes L3 B2500 W0',
    depth: 3,
    branching: 1000,
    target: 900_000,
    wide: 0,
  },
  { id: 'deep', label: 'Deep  nodes L10 B5 W0', depth: 10, branching: 5, target: 300_000, wide: 0 },
  { id: 'wide', label: 'Wide (5K siblings)', depth: 4, branching: 5, target: 100_000, wide: 4000 },
] as const
