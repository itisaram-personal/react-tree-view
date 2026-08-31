/**
 * Benchmark host. Renders the same dataset through the library's own
 * virtualized TreeView and through MUI X RichTreeView, and exposes a
 * `window.__bench` handle so Playwright can drive both identically.
 */
import { createRoot, type Root } from 'react-dom/client'
import { RichTreeView } from '@mui/x-tree-view/RichTreeView'
import { TreeView } from '../src'
import { makeTree, type DemoNode } from '../demo/data'

type Impl = 'custom-nowrap' | 'custom-wrap' | 'mui'

const HOST_H = 600

let root: Root | null = null
let data: DemoNode[] = []
let allIds: string[] = []
let branchIds: string[] = []

function collect(nodes: DemoNode[]) {
  allIds = []
  branchIds = []
  const walk = (list: DemoNode[]) => {
    for (const n of list) {
      allIds.push(String(n.id))
      if (n.children?.length) {
        branchIds.push(String(n.id))
        walk(n.children)
      }
    }
  }
  walk(nodes)
}

/** Resolves after the browser has painted the commit that just happened. */
const painted = () =>
  new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))

function scrollContainer(): HTMLElement {
  return (document.querySelector('.trt-root') ??
    document.querySelector('.bench-host')) as HTMLElement
}

const bench = {
  setup(depth: number, branching: number, target: number) {
    data = makeTree(depth, branching, target)
    collect(data)
    return { total: allIds.length, branches: branchIds.length }
  },

  async mount(impl: Impl) {
    const host = document.getElementById('root')!
    host.innerHTML = ''
    const mountPoint = document.createElement('div')
    host.appendChild(mountPoint)
    root = createRoot(mountPoint)

    const tree =
      impl === 'mui' ? (
        <div className="bench-host">
          <RichTreeView
            items={data as never}
            checkboxSelection
            multiSelect
            selectionPropagation={{ parents: true, descendants: true }}
            defaultExpandedItems={branchIds}
            isItemDisabled={(item: DemoNode) => !!item.disabled}
          />
        </div>
      ) : (
        <TreeView
          data={data}
          height={HOST_H}
          width={900}
          defaultExpandAll
          wrapLabels={impl === 'custom-wrap'}
        />
      )

    const t0 = performance.now()
    root.render(tree)
    await painted()
    const mountMs = performance.now() - t0

    const el = scrollContainer()
    return {
      mountMs,
      domNodes: document.querySelectorAll('#root *').length,
      scrollHeight: el?.scrollHeight ?? 0,
      heapMB: (performance as never as { memory?: { usedJSHeapSize: number } }).memory
        ? (performance as never as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize /
          1048576
        : null,
    }
  },

  /** Scrolls in fixed steps, recording the wall time of each animation frame. */
  async scrollTest(frames: number, step: number) {
    const el = scrollContainer()
    if (!el) return null
    el.scrollTop = 0
    await painted()

    const samples: number[] = []
    await new Promise<void>((res) => {
      let n = 0
      let last = performance.now()
      const tick = () => {
        const now = performance.now()
        if (n > 0) samples.push(now - last)
        last = now
        if (n >= frames) return res()
        n++
        el.scrollTop = el.scrollTop + step
        // Force the layout the scroll invalidated inside this frame.
        void el.scrollTop
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    samples.sort((a, b) => a - b)
    const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))]
    return {
      count: samples.length,
      p50: at(0.5),
      p95: at(0.95),
      max: samples[samples.length - 1],
      over16ms: samples.filter((s) => s > 16.7).length,
    }
  },

  /** Cost of one checkbox click that cascades through a whole subtree. */
  async clickCheckbox() {
    const el = scrollContainer()
    el.scrollTop = 0
    await painted()
    const box = document.querySelector(
      '.trt-check, .MuiTreeItem-checkbox input',
    ) as HTMLElement | null
    if (!box) return null
    const t0 = performance.now()
    box.click()
    await painted()
    return { ms: performance.now() - t0 }
  },

  unmount() {
    root?.unmount()
    root = null
    document.getElementById('root')!.innerHTML = ''
  },
}

;(window as never as { __bench: typeof bench }).__bench = bench
;(window as never as { __benchReady: boolean }).__benchReady = true
