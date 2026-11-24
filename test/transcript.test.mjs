// Behaviour tests for the pure half of the session-split client bundle.
//
// The bundle is a browser artifact loaded through `window.__ModuleLoader__`, so
// these tests boot the real `client.js` against a stub module loader, a stub
// React, and a stub storage, then exercise the helpers it exports through
// `__internals`. Nothing here needs the shell.
//
// Run: node test/transcript.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SOURCE = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Minimal React surface the bundle touches at factory time. */
const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== undefined) }
  },
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (callback) => callback,
}

/** Boot the bundle and return its plugin object. */
function boot(options = {}) {
  const entries = []
  const store = new Map(Object.entries(options.storage ?? {}))
  const window = {
    __ModuleLoader__: { load: (entry) => entries.push(entry) },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1600,
  }
  const document = {
    createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
    head: { append: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  class Element {}

  const run = new Function('window', 'document', 'console', 'Element', SOURCE)
  run(window, document, console, Element)
  assert.equal(entries.length, 1, 'the bundle registers exactly one module')
  assert.equal(entries[0].id, '@local/dsh-session-split')

  const plugin = entries[0].factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected module: ${id}`)
  })
  return { plugin, window, store, Element }
}

/** One durable session entry. */
function event(seq, type, data) {
  return { type: 'event', event: { type, seq, time: 1700000000000 + seq, data } }
}

const { plugin } = boot()
const api = plugin.__internals

// --- shape ---------------------------------------------------------------
assert.equal(plugin.name, 'session-split')
assert.deepEqual(plugin.inject, ['slots', 'sessions'])
assert.equal(typeof plugin.apply, 'function')
assert.equal(typeof api.buildTranscript, 'function')

// --- text block extraction ----------------------------------------------
assert.equal(
  api.textBlocks({ content: [{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'no' }, { type: 'text', text: 'b' }] }),
  'a\nb',
)
assert.equal(api.textBlocks({ content: [] }), '')
assert.equal(api.textBlocks(null), '')
assert.equal(api.textBlocks({ content: [{ type: 'image' }] }), '')

// --- argument summaries --------------------------------------------------
assert.equal(api.summarizeArgs('{"command":"node test.js --x"}'), 'node test.js --x')
assert.equal(api.summarizeArgs('{"file_path":"G:\\\\a\\\\b.ts","other":"x"}'), 'G:\\a\\b.ts')
assert.equal(api.summarizeArgs('{"pattern":"foo","path":"src"}'), 'foo')
assert.equal(api.summarizeArgs('not json at all'), 'not json at all')
assert.equal(api.summarizeArgs(''), '')
assert.equal(api.summarizeArgs(undefined), '')
assert.equal(api.summarizeArgs('{"nested":{"a":1}}'), '{"nested":{"a":1}}')

// --- transcript assembly -------------------------------------------------
const entries = [
  event(1, 'turn/start', { turn: 1 }),
  event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
  event(3, 'user/message', { source: { kind: 'inbox' }, content: [{ type: 'text', text: 'injected context' }] }),
  event(4, 'assistant/message', { message: { content: [{ type: 'text', text: 'hi **there**' }] } }),
  event(5, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' }),
  event(6, 'tool/result', { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'file.txt' }] } }),
  event(7, 'tool/call', { callId: 'c2', name: 'read', arguments: '{"file_path":"a.txt"}' }),
  event(8, 'tool/result', { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'ENOENT' }] } }),
  event(9, 'turn/end', { turn: 1, reason: { kind: 'error', failure: { code: 'X' } } }),
  { type: 'transient', event: { type: 'assistant/live-chunk', seq: 10, time: 1, data: { chunk: 'ignored' } } },
]

const rows = api.buildTranscript(entries)
assert.deepEqual(rows.map((row) => row.kind), ['user', 'assistant', 'tool', 'tool', 'notice'])
assert.equal(rows[0].text, 'hello', 'injected user messages are dropped')
assert.equal(rows[1].text, 'hi **there**')
assert.equal(rows[2].name, 'bash')
assert.equal(rows[2].status, 'done')
assert.equal(rows[2].result, 'file.txt')
assert.equal(rows[3].status, 'error')
assert.equal(rows[3].result, 'ENOENT')
assert.equal(rows[4].reasonKey, 'reason.error')

// A successful turn end is silent.
assert.equal(api.buildTranscript([event(1, 'turn/end', { turn: 1, reason: { kind: 'stop' } })]).length, 0)
// An orphan tool result still renders.
const orphan = api.buildTranscript([event(1, 'tool/result', { message: { toolCallId: 'zz', isError: false, content: [{ type: 'text', text: 'ok' }] } })])
assert.equal(orphan.length, 1)
assert.equal(orphan[0].kind, 'tool')
// The row cap keeps the newest rows.
const many = []
for (let index = 0; index < 30; index += 1) many.push(event(index, 'assistant/message', { message: { content: [{ type: 'text', text: `m${index}` }] } }))
const capped = api.buildTranscript(many, 5)
assert.equal(capped.length, 5)
assert.equal(capped[4].text, 'm29')
assert.deepEqual(api.buildTranscript(undefined), [])

// --- titles --------------------------------------------------------------
assert.equal(api.titleFromEvents([event(1, 'session/title', { title: 'first' }), event(2, 'session/title', { title: 'second' })]), 'second')
assert.equal(api.titleFromEvents([event(1, 'session/title', { title: '   ' })]), undefined)
assert.equal(api.titleFromEvents([]), undefined)
assert.equal(api.titleFromEvents(null), undefined)

// --- grid planning -------------------------------------------------------
assert.deepEqual(api.planGrid(0), { columns: 1, rows: 1 })
assert.deepEqual(api.planGrid(1), { columns: 1, rows: 1 })
assert.deepEqual(api.planGrid(2), { columns: 2, rows: 1 })
assert.deepEqual(api.planGrid(3), { columns: 3, rows: 1 })
assert.deepEqual(api.planGrid(4), { columns: 2, rows: 2 })
assert.deepEqual(api.planGrid(5), { columns: 3, rows: 2 })
assert.deepEqual(api.planGrid(6), { columns: 3, rows: 2 })
// Manual override wins, but never yields more columns than panes.
assert.deepEqual(api.planGrid(4, 3), { columns: 3, rows: 2 })
assert.deepEqual(api.planGrid(2, 4), { columns: 2, rows: 1 })
assert.deepEqual(api.planGrid(6, 2), { columns: 2, rows: 3 })
assert.deepEqual(api.planGrid(3, 0), { columns: 3, rows: 1 })
assert.deepEqual(api.planGrid(3, 9), { columns: 3, rows: 1 })
assert.deepEqual(api.planGrid(4, 3), { columns: 3, rows: 2 })
assert.equal(api.autoColumns(1), 1)
assert.equal(api.autoColumns(2), 2)
assert.equal(api.autoColumns(4), 2)
assert.equal(api.autoColumns(6), 3)

// --- pane reordering -----------------------------------------------------
assert.deepEqual(api.movePane(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'])
assert.deepEqual(api.movePane(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
assert.deepEqual(api.movePane(['a', 'b', 'c'], 1, 2), ['a', 'c', 'b'])
assert.deepEqual(api.movePane(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c'])
assert.deepEqual(api.movePane(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a'])
assert.deepEqual(api.movePane(['a', 'b', 'c'], 9, 0), ['a', 'b', 'c'])
assert.deepEqual(api.movePane(undefined, 0, 1), [])

// --- column widths -------------------------------------------------------
assert.deepEqual(api.equalWidths(1), [1])
assert.deepEqual(api.equalWidths(2), [0.5, 0.5])
assert.equal(api.equalWidths(3).length, 3)
assert.equal(api.equalWidths(3).reduce((a, b) => a + b, 0), 1)
// A width list of the wrong length falls back to an even split.
assert.deepEqual(api.normalizeWidths([0.2, 0.8], 3), api.equalWidths(3))
assert.deepEqual(api.normalizeWidths(undefined, 2), [0.5, 0.5])
// Widths are normalized to sum 1 and clamp degenerate values.
const normalized = api.normalizeWidths([2, 2], 2)
assert.equal(normalized[0], 0.5)
assert.equal(normalized[1], 0.5)
const squashed = api.normalizeWidths([0.98, 0.02], 2)
assert.deepEqual(squashed, [0.5, 0.5], 'a squashed column is repaired instead of kept')
// Gutter offsets are cumulative percentages between columns.
assert.deepEqual(api.gutterOffsets([0.5, 0.5]), [50])
assert.deepEqual(api.gutterOffsets([0.25, 0.25, 0.5]), [25, 50])
assert.deepEqual(api.gutterOffsets([1]), [])

// --- pane list rules -----------------------------------------------------
assert.equal(api.sessionIdFromRowKey('session:abc'), 'abc')
assert.equal(api.sessionIdFromRowKey('session:'), null)
assert.equal(api.sessionIdFromRowKey('workspace:abc'), null)
assert.equal(api.sessionIdFromRowKey(undefined), null)

assert.deepEqual(api.normalizePanes(['a', 'a', 'b', '', 3, null]), ['a', 'b'])
assert.deepEqual(api.normalizePanes(['a', 'b', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e', 'f'])
assert.deepEqual(api.normalizePanes(['a', 'b', 'c', 'd', 'e', 'f', 'g']), ['a', 'b', 'c', 'd', 'e', 'f'])
assert.deepEqual(api.normalizePanes('nope'), [])
assert.deepEqual(api.addPane(['a'], 'b'), ['a', 'b'])
assert.deepEqual(api.addPane(['a'], 'a'), ['a'])
assert.deepEqual(api.addPane(['a', 'b', 'c', 'd'], 'e'), ['a', 'b', 'c', 'd', 'e'])
// A full workbench drops the oldest pane to make room.
assert.deepEqual(api.addPane(['a', 'b', 'c', 'd', 'e', 'f'], 'g'), ['b', 'c', 'd', 'e', 'f', 'g'])
assert.deepEqual(api.removePane(['a', 'b'], 'a'), ['b'])
assert.deepEqual(api.removePane(undefined, 'a'), [])
assert.equal(api.MAX_PANES, 6)

// --- markdown ------------------------------------------------------------
const markdown = api.renderMarkdown('# Title\n\nhello **bold** and `code`\n\n- one\n- two\n\n```js\nconst a = 1\n```\n\n[dsh](https://example.com)', 'k')
const kinds = markdown.map((node) => node.type)
assert.deepEqual(kinds, ['div', 'p', 'div', 'div', 'pre', 'p'])
assert.equal(markdown[0].props.className, 'ssp-md-heading')
assert.equal(markdown[4].type, 'pre')
assert.equal(markdown[4].children[0].children[0], 'const a = 1')
const paragraphChildren = markdown[1].children
assert.equal(paragraphChildren[0], 'hello ')
assert.equal(paragraphChildren[1].type, 'strong')
assert.equal(paragraphChildren[2], ' and ')
assert.equal(paragraphChildren[3].type, 'code')
const link = markdown[5].children[0]
assert.equal(link.type, 'a')
assert.equal(link.props.href, 'https://example.com')

// --- translation ---------------------------------------------------------
const zhContext = { get: () => ({ getSnapshot: () => ({ active: 'zh-CN' }) }) }
const enContext = { get: () => ({ getSnapshot: () => ({ active: 'en' }) }) }
assert.equal(api.translate(zhContext, 'panel.title'), '会话分屏')
assert.equal(api.translate(enContext, 'panel.title'), 'Session split view')
assert.equal(api.translate(zhContext, 'pane.sendFailed', { message: 'boom' }), '发送失败：boom')
assert.equal(api.translate({ get: () => undefined }, 'missing.key'), 'missing.key')

// --- pane state survives a reload ---------------------------------------
const restored = boot({ storage: { 'dsh-session-split:v1': JSON.stringify({ panes: ['x', 'x', 'y'] }) } })
assert.deepEqual(restored.plugin.__internals.normalizePanes(['x', 'x', 'y']), ['x', 'y'])

// --- content phase (hero vs active) -------------------------------------
assert.deepEqual(api.contentPhaseOf(undefined), { phase: 'active', hero: false })
assert.deepEqual(api.contentPhaseOf({ openState: 'loading' }), { phase: 'settling', hero: false })
// A blank Session that has not started running is the hero home.
assert.deepEqual(api.contentPhaseOf({ blank: true, awaitingFirstTurn: false, running: false, openState: 'open' }), { phase: 'hero', hero: true })
// A running blank Session is active.
assert.deepEqual(api.contentPhaseOf({ blank: true, running: true, openState: 'open' }), { phase: 'active', hero: false })
// A Session WITH history is never hero, even before promptAttempted is projected.
assert.deepEqual(api.contentPhaseOf({ blank: false, promptAttempted: false, running: false, openState: 'open' }), { phase: 'active', hero: false })
assert.deepEqual(api.contentPhaseOf({ blank: false, promptAttempted: true, running: false, openState: 'open' }), { phase: 'active', hero: false })
assert.deepEqual(api.contentPhaseOf({ blank: false, awaitingFirstTurn: true, running: false, openState: 'open' }), { phase: 'active', hero: false })

console.log('transcript.test.mjs: all assertions passed')
