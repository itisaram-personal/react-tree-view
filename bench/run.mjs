/**
 * Drives the bench page in Chromium and prints a comparison table.
 * Usage: node bench/run.mjs [url]
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PW = 'C:/Users/Target-PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright'
const { chromium } = require(PW)

const URL = process.argv[2] ?? 'http://localhost:5210/'

// depth / branching / target -> "all expanded" visible-row count == total nodes
const SIZES = [
  { name: '1K', depth: 4, branching: 6, target: 1_000 },
  { name: '10K', depth: 5, branching: 7, target: 10_000 },
  { name: '50K', depth: 6, branching: 8, target: 50_000 },
]
const IMPLS = ['custom-nowrap', 'custom-wrap', 'mui']

const fmt = (v, d = 1) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v))

/** Caps any single measurement so one pathological mount cannot stall the run. */
const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} exceeded ${ms}ms`)), ms)),
  ])

const browser = await chromium.launch({
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
await page.goto(URL, { waitUntil: 'load' })
await page.waitForFunction('window.__benchReady === true', { timeout: 30_000 })

const rows = []

for (const size of SIZES) {
  const info = await page.evaluate(
    ([d, b, t]) => window.__bench.setup(d, b, t),
    [size.depth, size.branching, size.target],
  )
  console.error(`\n=== ${size.name}: ${info.total} nodes (${info.branches} branches), all expanded`)

  for (const impl of IMPLS) {
    await page.evaluate(() => window.__bench.unmount())
    let rec = { size: size.name, total: info.total, impl }
    try {
      const m = await withTimeout(
        page.evaluate((i) => window.__bench.mount(i), impl),
        120_000,
        'mount',
      )
      rec = { ...rec, ...m }
      const s = await withTimeout(
        page.evaluate(() => window.__bench.scrollTest(60, 240)),
        120_000,
        'scroll',
      )
      rec.scroll = s
      const c = await withTimeout(
        page.evaluate(() => window.__bench.clickCheckbox()),
        120_000,
        'check',
      )
      rec.checkMs = c?.ms ?? null
    } catch (err) {
      rec.error = String(err.message ?? err).slice(0, 120)
    }
    rows.push(rec)
    console.error(
      `  ${impl.padEnd(14)} mount ${fmt(rec.mountMs)}ms  dom ${rec.domNodes ?? '—'}  ` +
        `scrollp95 ${fmt(rec.scroll?.p95)}ms  check ${fmt(rec.checkMs)}ms  ${rec.error ?? ''}`,
    )
  }
}

await page.evaluate(() => window.__bench.unmount())
await browser.close()

const H = ['nodes', 'impl', 'mount ms', 'DOM nodes', 'heap MB', 'scroll p50', 'scroll p95', 'frames>16.7ms', 'check ms']
const body = rows.map((r) => [
  `${r.size} (${r.total})`,
  r.impl,
  r.error ? 'FAILED' : fmt(r.mountMs),
  r.error ? '—' : String(r.domNodes),
  fmt(r.heapMB),
  fmt(r.scroll?.p50),
  fmt(r.scroll?.p95),
  r.scroll ? `${r.scroll.over16ms}/${r.scroll.count}` : '—',
  fmt(r.checkMs),
])
const w = H.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
const line = (cells) => '| ' + cells.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |'
console.log(line(H))
console.log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|')
for (const b of body) console.log(line(b))
