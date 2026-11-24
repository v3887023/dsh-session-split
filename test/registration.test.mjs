// Wiring test for the session-split client half, without the shell.
//
// Boots the real bundle against a stub Cordis context, then drives the three
// facts that decide whether the feature works at all: which slots it
// contributes, whether the Session-row menu entry switches the main panel and
// adds a pane, and whether a Session row dragged inside the workbench lands as
// a pane while a drag anywhere else is left to the shipped behaviour.
//
// Run: node test/registration.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SOURCE = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  Fragment: 'Fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
  useCallback: (callback) => callback,
}

/** Fake element: enough `Element` surface for the plugin's closest()/instanceof. */
class FakeElement {
  constructor(attributes = {}, parent = null) {
    this.attributes = { ...attributes }
    this.parent = parent
    this.isConnected = true
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }

  closest(selector) {
    for (let node = this; node !== null && node !== undefined; node = node.parent) {
      if (selector === '[data-row-key]' && typeof node.attributes['data-row-key'] === 'string') return node
      if (selector === '[data-ssp-panel]' && Object.prototype.hasOwnProperty.call(node.attributes, 'data-ssp-panel')) return node
    }
    return null
  }
}

/** Boot the bundle against a stub shell. */
function boot(options = {}) {
  const rendered = []
  const store = new Map()
  const listeners = new Map()
  const effects = []
  const writes = []
  const styled = []
  const createElement = (tag) => {
    const element = { tag, dataset: {}, textContent: '', style: {}, removed: false, remove() { this.removed = true } }
    return element
  }

  const window = {
    __ModuleLoader__: { load: (entry) => rendered.push(entry) },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); writes.push({ key, value }) },
    },
    addEventListener: (type, handler) => {
      const list = listeners.get(type) ?? []
      list.push(handler)
      listeners.set(type, list)
    },
    removeEventListener: (type, handler) => {
      const list = listeners.get(type) ?? []
      listeners.set(type, list.filter((item) => item !== handler))
    },
    innerWidth: 1600,
  }
  const document = {
    createElement,
    head: { append: (element) => styled.push(element) },
    querySelector: () => null,
    querySelectorAll: () => [],
  }

  const registrations = []
  const injections = []
  const layoutCalls = []
  const opened = []
  const ctx = {
    effect(factory) {
      const cleanup = factory()
      effects.push(cleanup)
      return () => { if (typeof cleanup === 'function') cleanup() }
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
          retain: () => { throw new Error('retain is not exercised in this stub') },
        }
      }
      if (name === 'locale') return { getSnapshot: () => ({ active: options.locale ?? 'zh-CN' }) }
      if (name === 'layout') return { selectPanel: (id) => layoutCalls.push(id) }
      if (name === 'uiWorkspace') return { openSession: (id) => opened.push(id) }
      return undefined
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        return callback()
      },
      register(slotOptions, component) {
        registrations.push({ ...slotOptions, component })
        return () => {}
      },
    },
  }

  const run = new Function('window', 'document', 'console', 'Element', SOURCE)
  run(window, document, console, FakeElement)
  const plugin = rendered[0].factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected module: ${id}`)
  })
  plugin.apply(ctx)

  const fire = (type, event) => {
    for (const handler of listeners.get(type) ?? []) handler(event)
  }
  const handlersOf = (type) => listeners.get(type) ?? []
  const slot = (name) => registrations.find((entry) => entry.name === name)

  return { plugin, registrations, injections, layoutCalls, opened, writes, styled, effects, fire, handlersOf, slot, store, listeners }
}

// --- contributions -------------------------------------------------------
{
  const shell = boot()
  const names = shell.registrations.map((entry) => entry.name).sort()
  assert.deepEqual(names, [
    'conversation.session.header.utilities',
    'main',
    'shell.overlay',
    'shell.overlay',
    'shell.overlay',
    'sidebar.panellist',
    'sidebar.workspaces.session.menu.item',
  ])
  assert.deepEqual(shell.injections.sort(), [
    'conversation.session.header.utilities',
    'main',
    'shell.overlay',
    'shell.overlay',
    'shell.overlay',
    'sidebar.panellist',
    'sidebar.workspaces.session.menu.item',
  ])
  const overlayIds = shell.registrations.filter((entry) => entry.name === 'shell.overlay').map((entry) => entry.id).sort()
  assert.deepEqual(overlayIds, ['session-split-bar', 'session-split-drop-hint', 'session-split-host'])

  assert.equal(shell.slot('main').key, 'session-split')
  assert.equal(shell.slot('sidebar.panellist').id, 'session-split')
  assert.equal(typeof shell.slot('sidebar.panellist').label, 'function')
  assert.equal(shell.slot('sidebar.panellist').label(), '会话分屏')
  assert.equal(shell.slot('sidebar.workspaces.session.menu.item').id, 'session-split-row')
  assert.equal(shell.slot('shell.overlay').id, 'session-split-host')

  // Styles are installed once and removed on unload.
  assert.equal(shell.styled.length, 1)
  assert.match(shell.styled[0].textContent, /ssp-root/)
  for (const cleanup of shell.effects) if (typeof cleanup === 'function') cleanup()
  assert.equal(shell.styled[0].removed, true)
  assert.equal(shell.handlersOf('dragover').length, 0, 'drag listeners are removed on unload')
}

// --- Session-row menu entry ---------------------------------------------
{
  const shell = boot()
  const row = shell.slot('sidebar.workspaces.session.menu.item')
  const closed = []
  const tree = row.component({ sessionId: 's2', useMenuOpenState: () => [{ open: true }, (value) => closed.push(value)] })
  assert.equal(tree.type, 'button')
  assert.equal(tree.props.role, 'menuitem')
  assert.equal(tree.children[0].props.className, 'ssp-menu-row-icon')
  assert.equal(tree.children[1].children[0], '在分屏中打开')
  tree.props.onClick()
  assert.deepEqual(closed, [false], 'picking the row closes the menu')
  assert.deepEqual(shell.layoutCalls, ['session-split'], 'picking the row shows the workbench')
  const persisted = JSON.parse(shell.writes.at(-1).value)
  assert.deepEqual(persisted.panes, ['s2'], 'the pane list is persisted')
}

// --- drag gesture --------------------------------------------------------
{
  const shell = boot()
  const panel = new FakeElement({ 'data-ssp-panel': '' })
  const pane = new FakeElement({}, panel)
  const sidebarRow = new FakeElement({ 'data-row-key': 'session:s1' })
  const transfer = { data: new Map(), dropEffect: 'none', setData(key, value) { this.data.set(key, value) } }

  shell.fire('dragstart', { target: sidebarRow, dataTransfer: transfer })
  assert.equal(transfer.data.get('application/x-dsh-session-split'), 's1')

  // Over the sidebar row itself: not our zone.
  let prevented = false
  shell.fire('dragover', { target: sidebarRow, dataTransfer: transfer, preventDefault: () => { prevented = true } })
  assert.equal(prevented, false, 'the sidebar keeps its own drop handling')

  // Over the workbench: claimed.
  let claimed = false
  shell.fire('dragover', { target: pane, dataTransfer: transfer, preventDefault: () => { claimed = true } })
  assert.equal(claimed, true, 'the workbench claims the drop')
  assert.equal(transfer.dropEffect, 'move')

  let dropped = false
  let propagated = true
  shell.fire('drop', {
    target: pane,
    dataTransfer: transfer,
    preventDefault: () => { dropped = true },
    stopPropagation: () => { propagated = false },
  })
  assert.equal(dropped, true)
  assert.equal(propagated, false)
  assert.deepEqual(shell.layoutCalls, ['session-split'])
  assert.deepEqual(JSON.parse(shell.writes.at(-1).value).panes, ['s1'])

  // The next drag no longer carries the previous Session.
  shell.fire('dragend', {})
  let secondClaim = false
  shell.fire('dragover', { target: pane, dataTransfer: transfer, preventDefault: () => { secondClaim = true } })
  assert.equal(secondClaim, false)
}

// --- dropping outside the workbench is never claimed ---------------------
{
  const shell = boot()
  const conversation = new FakeElement({}, null)
  const sidebarRow = new FakeElement({ 'data-row-key': 'session:s2' })
  const transfer = { data: new Map(), dropEffect: 'none', setData() {} }
  shell.fire('dragstart', { target: sidebarRow, dataTransfer: transfer })
  let prevented = false
  shell.fire('dragover', { target: conversation, dataTransfer: transfer, preventDefault: () => { prevented = true } })
  assert.equal(prevented, false, 'the Conversation page keeps the shipped reference drop')
  let dropped = false
  shell.fire('drop', { target: conversation, dataTransfer: transfer, preventDefault: () => { dropped = true }, stopPropagation: () => {} })
  assert.equal(dropped, false)
  assert.deepEqual(shell.layoutCalls, [])
}

// --- a restored pane list is honored ------------------------------------
{
  // Persisted state is read when the module factory runs, before `apply`.
  const store = new Map([['dsh-session-split:v1', JSON.stringify({ panes: ['s1', 's2', 's1'] })]])
  const rendered = []
  const window = {
    __ModuleLoader__: { load: (entry) => rendered.push(entry) },
    localStorage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { append: () => {} } }
  const run = new Function('window', 'document', 'console', 'Element', SOURCE)
  run(window, document, console, FakeElement)
  const plugin = rendered[0].factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected module: ${id}`)
  })
  // Normalization happens on read; a stale duplicate never renders twice.
  assert.deepEqual(plugin.__internals.normalizePanes(['s1', 's2', 's1']), ['s1', 's2'])
}

console.log('registration.test.mjs: all assertions passed')



