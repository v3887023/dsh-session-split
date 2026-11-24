// Render smoke test for the session-split client half.
//
// The real bundle needs React from the browser module table, which is not
// resolvable from a plain Node process (it lives inside the DSH asar). This
// test substitutes a miniature hook runtime with the same call shapes, applies
// the bundle against a stub shell, and renders the workbench twice: empty, and
// with two panes. That catches the failures an offline shell can prove —
// undefined access during render, broken hook order across renders, wrong grid
// markers, a pane that renders nothing before its Session settles.
//
// Run: node test/render.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SOURCE = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** One hook slot list, reset for every render pass. */
let hooks = []
let hookIndex = 0

const ReactStub = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== undefined && child !== null) }
  },
  useState(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
  },
  useEffect() {},
  useMemo(factory) {
    hookIndex += 1
    return factory()
  },
  useRef(initial) {
    hookIndex += 1
    return { current: initial }
  },
  useCallback(callback) {
    hookIndex += 1
    return callback
  },
}

class FakeElement {}

function boot(storage = new Map()) {
  const entries = []
  const window = {
    __ModuleLoader__: { load: (entry) => entries.push(entry) },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    addEventListener() {},
    removeEventListener() {},
  }
  const document = {
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { append() {} },
  }
  const run = new Function('window', 'document', 'console', 'Element', SOURCE)
  run(window, document, console, FakeElement)
  const plugin = entries[0].factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected module: ${id}`)
  })
  const registrations = []
  const ctx = {
    effect(factory) {
      factory()
      return () => {}
    },
    get(name) {
      if (name === 'sessions') {
        return {
          list: {
            getSnapshot: () => ({
              byId: {
                s1: { id: 's1', title: 'Alpha', retainedBy: { mainView: 1 } },
                s2: { id: 's2', title: 'Beta', retainedBy: {} },
              },
            }),
          },
          retain() { throw new Error('retain is not exercised here') },
        }
      }
      if (name === 'locale') return { getSnapshot: () => ({ active: 'zh-CN' }) }
      if (name === 'layout') return { selectPanel() {} }
      if (name === 'uiWorkspace') return { openSession() {} }
      return undefined
    },
    slots: {
      inject(key, callback) { return callback() },
      register(options, component) { registrations.push({ ...options, component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  return { plugin, registrations }
}

/** Render one component with a fresh hook table. */
function render(component, props) {
  hooks = []
  hookIndex = 0
  return component(props)
}

/** Collect `class` names down a rendered tree. */
function classesOf(node, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (typeof node.props?.className === 'string') found.push(node.props.className)
  for (const child of node.children ?? []) classesOf(child, found)
  return found
}

// --- empty workbench -----------------------------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  api.setPanes([])
  const tree = render(api.SplitWorkbench, {})
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'ssp-root')
  assert.equal(tree.props['data-ssp-panel'], '')
  const classes = classesOf(tree)
  assert.ok(classes.includes('ssp-toolbar'), 'toolbar renders')
  assert.ok(classes.includes('ssp-empty'), 'empty state renders without panes')

  const title = tree.children[0].children[0]
  assert.equal(title.children[0], '会话分屏')
  // Toolbar: title, count, columns, spacer, follow, compact, add, minimise, clear.
  assert.equal(tree.children[0].children.length, 9)
  const followButton = tree.children[0].children[4]
  assert.equal(followButton.type, 'button')
  const compactButton = tree.children[0].children[5]
  assert.equal(compactButton.type, 'button')
  const addSessionButton = tree.children[0].children[6]
  assert.equal(addSessionButton.type, 'button')
  const minimizeButton = tree.children[0].children[7]
  assert.equal(minimizeButton.type, 'button')
  assert.equal(minimizeButton.props.disabled, true, 'nothing to minimise without panes')
  const clearButton = tree.children[0].children[8]
  assert.equal(clearButton.type, 'button')
  assert.equal(clearButton.props.disabled, true)
  // The column control offers Auto/2/3/4.
  const columns = tree.children[0].children[2]
  assert.equal(columns.props.className, 'ssp-columns')
  assert.equal(columns.children.length, 5)
}

// --- two panes -----------------------------------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  api.setPanes(['s1', 's2'])
  const tree = render(api.SplitWorkbench, {})
  const grid = tree.children[1]
  assert.equal(grid.props.className, 'ssp-grid')
  assert.equal(grid.props.style.gridTemplateColumns, '0.5fr 0.5fr')
  // Two panes plus one divider.
  assert.equal(grid.children.length, 3)
  const gutter = grid.children[2]
  assert.equal(gutter.props.className, 'ssp-gutter')
  assert.equal(gutter.props.style.left, '50%')
  assert.equal(typeof gutter.props.onPointerDown, 'function')
  assert.equal(typeof gutter.props.onDoubleClick, 'function')

  const first = render(grid.children[0].type, grid.children[0].props)
  assert.equal(first.type, 'section')
  assert.equal(first.props['data-ssp-pane'], 's1')
  // Before its binding settles a pane shows the loading state, not a crash.
  assert.ok(classesOf(first).includes('ssp-pane-state'))
  // The title falls back to the sidebar projection.
  const head = first.children[0]
  assert.equal(head.children[1].children[0], 'Alpha')
  // While the binding settles there is no composer yet (the pane shows loading).
  assert.equal(first.children.length, 2)
  assert.equal(classesOf(first).includes('ssp-input'), false)
}

// --- three panes lay out as three columns --------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  api.setColumns(0)
  api.setPanes(['s1', 's2', 's3'])
  const tree = render(api.SplitWorkbench, {})
  const grid = tree.children[1]
  const columns = String(grid.props.style.gridTemplateColumns).split(' ')
  assert.equal(columns.length, 3)
  assert.ok(columns.every((part) => part.endsWith('fr')))
  assert.equal(grid.props.style.gridTemplateRows, 'repeat(1, minmax(0, 1fr))')
  // Three panes plus two dividers.
  assert.equal(grid.children.length, 5)
  assert.equal(grid.children[3].props.style.left !== undefined, true)
  // No pane spans: every cell is one grid area.
  const second = render(grid.children[1].type, grid.children[1].props)
  assert.equal(second.props.style, undefined)
}

// --- the manual column override reaches the grid --------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  api.setPanes(['s1', 's2', 's3', 's4'])
  api.setColumns(3)
  const tree = render(api.SplitWorkbench, {})
  const grid = tree.children[1]
  assert.equal(String(grid.props.style.gridTemplateColumns).split(' ').length, 3)
  assert.equal(grid.props.style.gridTemplateRows, 'repeat(2, minmax(0, 1fr))')
  api.setColumns(0)
}

// --- dragging a pane marks the drop target -------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  api.setPanes(['s1', 's2'])
  const pane = render(api.SessionPane, { sessionId: 's2', t: (key) => key, index: 1, dropTarget: true })
  assert.equal(pane.props['data-drop-target'], '')
  const plain = render(api.SessionPane, { sessionId: 's2', t: (key) => key, index: 1 })
  assert.equal(plain.props['data-drop-target'], undefined)
  // The header is the drag handle.
  const head = pane.children[0]
  assert.equal(head.props.draggable, true)
  assert.equal(head.props['data-ssp-grip'], '')
}

// --- a pane in its own right --------------------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  const tree = render(api.SessionPane, { sessionId: 's2', t: (key) => key })
  assert.equal(tree.props['data-ssp-pane'], 's2')
  const classes = classesOf(tree)
  assert.ok(classes.includes('ssp-pane-head'))
  assert.ok(classes.includes('ssp-pane-state'))
  // A loading pane has no composer; one appears once its Session is ready.
  assert.equal(classes.includes('ssp-input'), false)
  // An unknown Session title falls back to its id prefix rather than empty text.
  const title = tree.children[0].children[1]
  assert.equal(title.children[0], 'Beta')
}

// --- sidebar entry and drop hint ----------------------------------------
{
  const shell = boot()
  const api = shell.plugin.__internals
  const entry = render(api.PanelEntry, { size: 18, active: false })
  const svg = render(entry.type, entry.props)
  assert.equal(svg.type, 'svg')
  assert.equal(svg.props.width, 18)
  const idle = render(api.DropHint, {})
  assert.equal(idle, null, 'the hint only exists while a row hovers the workbench')
}

console.log('render.test.mjs: all assertions passed')
