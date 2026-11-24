/**
 * Client half of the session-split bundle.
 *
 * The workbench renders the SHIPPED Conversation body for every pane. The slot
 * renderer exposes exactly two pieces for that, and this plugin uses only those:
 *
 * 1. `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero })`
 *    renders the registered Conversation body (chat flow, composer, tool cards,
 *    approvals, question cards) at any position.
 * 2. `SessionProvider` re-targets that occurrence at one `SessionReference`,
 *    which `ctx.sessions.retain(id)` hands out. Both arrive in the render kit a
 *    Slot component receives once its registration declares a Session-scoped
 *    child.
 *
 * Passing the same `variant`/`phase`/`hero` the host's own embedded occurrence
 * (the right Sidebar chat tab) passes is what keeps the composer pinned; without
 * them the body drops its own positioning rules.
 *
 * What a pane deliberately does NOT render is the Conversation header (title
 * row, subagent tree, View tabs): those live in the `main.conversation` slot,
 * which is a single slot — declaring it from a plugin collapses the host's own
 * declaration and takes the whole conversation page down. A pane therefore adds
 * a compact one-line bar of its own (drag handle, title, state, subagents as
 * chips, open-native, close), and the body fills the rest.
 *
 * Layout:
 * - 1..6 panes in an automatic grid (2 side by side, 3 as columns, 4 as 2×2,
 *   5-6 as 3×2), with a manual column override (2/3/4) in the toolbar.
 * - Dragging a pane by its title bar reorders it: drop on another pane to take
 *   that slot, drop on empty canvas to move it to the end.
 * - Dragging a Session row from the sidebar into the workbench adds a pane.
 *
 * Every resource (styles, listeners, retained references, slot registrations)
 * lives in an `ctx.effect` so unloading the plugin leaves nothing behind.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-session-split',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    /** Panel identity shared by the sidebar entry and the main-slot occupant. */
    const PANEL_ID = 'session-split'
    /** How many panes the workbench holds. */
    const MAX_PANES = 6
    /** How many transcript rows one fallback pane renders. */
    const MAX_ROWS = 240
    /** Drag type carrying a Session row dragged in this page. */
    const SESSION_DRAG_TYPE = 'application/x-dsh-session-split'
    /** Drag type carrying a pane header dragged inside the workbench. */
    const PANE_DRAG_TYPE = 'application/x-dsh-split-pane'
    /** Where the workbench state survives a reload. */
    const STORAGE_KEY = 'dsh-session-split:v2'

    /** Chinese copy. */
    const zh = {
      'panel.title': '会话分屏',
      'panel.dropPreview': '松开插入窗格',
      'panel.hint': '从左侧拖动会话到这里，或右键某个会话选择「在分屏中打开」',
      'panel.addCurrent': '加入当前会话',
      'panel.addSession': '添加会话',
      'panel.addSelected': '添加 {count} 个',
      'panel.cancel': '取消',
      'panel.searchSessions': '搜索会话…',
      'panel.noSessions': '没有可添加的会话',
      'panel.groupByWorkspace': '按工作区分组',
      'panel.unknownWorkspace': '未分组工作区',
      'panel.followOpened': '已打开会话高亮',
      'panel.followHint': '开启：点击已在分屏里的会话只高亮那一格；关闭：直接打开原生会话',
      'panel.compactComposer': '压缩输入框',
      'panel.compactHint': '开启：输入框压缩成一行（只保留输入框和发送按钮）',
      'panel.minimize': '最小化',
      'bar.label': '会话分屏',
      'bar.restore': '返回分屏',
      'bar.close': '关闭悬浮条',
      'bar.hint': '拖动可移动，点击返回分屏',
      'panel.clear': '清空',
      'panel.columns': '列',
      'panel.columnsAuto': '自动',
      'panel.resize': '拖动调整列宽，双击复位',
      'panel.empty': '还没有窗格',
      'pane.openNative': '打开原生会话',
      'pane.openSubagent': '在分屏中打开这个子 Agent',
      'pane.moreSubagents': '更多子 Agent',
      'pane.subagentCount': '{count} 个子 Agent',
      'pane.unread': '有未读结果',
      'pane.pasteImageHint': '分屏里粘贴图片会插进输入框，请用输入框左侧的 ＋ 按钮添加图片',
      'pane.compactPlaceholder': '发消息…',
      'pane.remove': '移除窗格',
      'pane.drag': '拖动这里调整顺序',
      'pane.placeholder': '发消息…',
      'pane.send': '发送',
      'pane.stop': '停止',
      'pane.loading': '正在读取会话…',
      'pane.failed': '无法读取这个会话',
      'pane.retry': '重试',
      'pane.running': '运行中',
      'pane.idle': '空闲',
      'pane.more': '更早的消息请到原生会话查看',
      'pane.toolRunning': '执行中',
      'pane.toolDone': '完成',
      'pane.toolError': '失败',
      'pane.sendFailed': '发送失败：{message}',
      'pane.interrupted': '（已中断）',
      'pane.untitled': '未命名会话',
      'drop.panel': '松开加入窗格',
      'drop.reorder': '松开移动到此处',
      'menu.open': '在分屏中打开',
      'reason.error': '这一轮出错结束了',
      'reason.aborted': '这一轮被中断',
      'reason.cancelled': '这一轮已取消',
    }
    /** English copy. */
    const en = {
      'panel.title': 'Session split view',
      'panel.hint': 'Drag a conversation here from the sidebar, or right-click one and pick Open in split view',
      'panel.addCurrent': 'Add current conversation',
      'panel.addSession': 'Add session',
      'panel.addSelected': 'Add {count}',
      'panel.cancel': 'Cancel',
      'panel.searchSessions': 'Search conversations…',
      'panel.noSessions': 'Nothing to add',
      'panel.groupByWorkspace': 'By workspace',
      'panel.unknownWorkspace': 'Other workspace',
      'panel.followOpened': 'Highlight opened',
      'panel.followHint': 'On: clicking an already-shown Session just highlights its pane. Off: it opens natively.',
      'panel.compactComposer': 'Compact composer',
      'panel.compactHint': 'On: the composer collapses to one line (input + send only).',
      'panel.minimize': 'Minimize',
      'bar.label': 'Session split',
      'bar.restore': 'Back to split view',
      'bar.close': 'Close the bar',
      'bar.hint': 'Drag to move, click to return',
      'panel.clear': 'Clear',
      'panel.columns': 'Columns',
      'panel.columnsAuto': 'Auto',
      'panel.resize': 'Drag to resize columns, double-click to reset',
      'panel.empty': 'No panes yet',
      'panel.dropPreview': 'Drop to add a pane',
      'pane.openNative': 'Open native conversation',
      'pane.openSubagent': 'Open this subagent in a pane',
      'pane.moreSubagents': 'More subagents',
      'pane.subagentCount': '{count} subagents',
      'pane.unread': 'New result',
      'pane.pasteImageHint': 'Pasting images is not supported in a pane yet — use the ＋ attach button instead.',
      'pane.compactPlaceholder': 'Message…',
      'pane.remove': 'Remove pane',
      'pane.drag': 'Drag to reorder',
      'pane.placeholder': 'Send a message…',
      'pane.send': 'Send',
      'pane.stop': 'Stop',
      'pane.loading': 'Loading conversation…',
      'pane.failed': 'Could not load this conversation',
      'pane.retry': 'Retry',
      'pane.running': 'Running',
      'pane.idle': 'Idle',
      'pane.more': 'Older messages live in the native conversation',
      'pane.toolRunning': 'running',
      'pane.toolDone': 'done',
      'pane.toolError': 'failed',
      'pane.sendFailed': 'Send failed: {message}',
      'pane.interrupted': ' (interrupted)',
      'pane.untitled': 'Untitled conversation',
      'drop.panel': 'Release to add a pane',
      'drop.reorder': 'Release to move here',
      'menu.open': 'Open in split view',
      'reason.error': 'This turn ended with an error',
      'reason.aborted': 'This turn was aborted',
      'reason.cancelled': 'This turn was cancelled',
    }

    /** The live Client root context, published by `apply` for slot components. */
    const ctxRef = { current: null }

    /**
     * The render kit, published by the `main` seat.
     *
     * The visible workbench lives in `shell.overlay` so that switching panels
     * never unmounts it, but only `main` occupants receive `SessionProvider`,
     * `renderFactorySlot` and the Session/Workspace selector hooks. The seat
     * caches them here (as plain data for the hooks) and the overlay consumes
     * them.
     */
    const kitStore = { kit: null, listeners: new Set() }
    function publishKit(kit) {
      kitStore.kit = kit
      for (const listener of Array.from(kitStore.listeners)) listener()
    }
    function useKit() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        kitStore.listeners.add(listener)
        return () => {
          kitStore.listeners.delete(listener)
        }
      }, [])
      return kitStore.kit
    }

    /** Resolve one dictionary key, following the active locale. */
    function translate(ctx, key, params) {
      let active = 'en'
      try {
        const locale = ctx !== null && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale !== undefined && locale !== null && typeof locale.getSnapshot === 'function') {
          active = String(locale.getSnapshot().active ?? 'en')
        }
      } catch {
        active = 'en'
      }
      const dictionary = active.toLowerCase().startsWith('zh') ? zh : en
      let template = dictionary[key] ?? en[key] ?? key
      if (params !== undefined && params !== null) {
        template = template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
      }
      return template
    }

    // ---------------------------------------------------------------------
    // Pure helpers (unit-tested without the shell)
    // ---------------------------------------------------------------------

    /** Concatenate the text blocks of one message, ignoring every other block. */
    function textBlocks(message) {
      if (message === null || message === undefined || !Array.isArray(message.content)) return ''
      const parts = []
      for (const block of message.content) {
        if (block !== null && block !== undefined && block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text)
        }
      }
      return parts.join('\n').trim()
    }

    /** One-line preview of a raw tool-argument JSON string. */
    function summarizeArgs(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return ''
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      const source = parsed !== null && typeof parsed === 'object' ? parsed : null
      if (source !== null) {
        for (const key of ['command', 'file_path', 'pattern', 'query', 'path', 'url', 'description']) {
          const value = source[key]
          if (typeof value === 'string' && value.trim() !== '') return value.trim().replace(/\s+/gu, ' ')
        }
        const first = Object.values(source).find((value) => typeof value === 'string' && value.trim() !== '')
        if (typeof first === 'string') return first.trim().replace(/\s+/gu, ' ')
      }
      return raw.trim().replace(/\s+/gu, ' ')
    }

    /** Localized label for a TurnEndReason, or null when the turn ended normally. */
    function reasonKey(reason) {
      const kind = reason !== null && typeof reason === 'object' ? reason.kind : undefined
      if (kind === 'error') return 'reason.error'
      if (kind === 'aborted') return 'reason.aborted'
      if (kind === 'cancelled' || kind === 'canceled') return 'reason.cancelled'
      return null
    }

    /**
     * The `phase`/`hero` inputs the shipped Conversation body expects.
     *
     * Hero is the blank-session home: it has no ordinary composer, so a pane
     * that guessed `hero` for a Session WITH history would show a transcript
     * and no input box until the Session starts running. The rule below only
     * enters hero for a Session the snapshot reports as blank, and otherwise
     * settles on `active` — a body that is already open but whose history has
     * not been applied yet must not be mistaken for a blank one.
     *
     * @param snapshot - `SessionSnapshot`, or undefined while the binding settles.
     * @returns `{ phase, hero }` for `conversation.content`.
     */
    function contentPhaseOf(snapshot) {
      if (snapshot === null || snapshot === undefined) return { phase: 'active', hero: false }
      if (snapshot.openState === 'loading') return { phase: 'settling', hero: false }
      const blank = snapshot.blank === true && snapshot.awaitingFirstTurn !== true
      const hero = blank && snapshot.running !== true
      return { phase: hero ? 'hero' : 'active', hero }
    }

    /**
     * Fold one Session event window into renderable transcript rows for the
     * fallback view (used only when the render kit is unavailable).
     */
    function buildTranscript(entries, limit) {
      const rows = []
      if (!Array.isArray(entries)) return rows
      const calls = new Map()
      for (const entry of entries) {
        if (entry === null || entry === undefined || entry.type !== 'event' || !entry.event) continue
        const event = entry.event
        const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
        if (event.type === 'user/message') {
          const source = data.source !== null && typeof data.source === 'object' ? data.source : {}
          if (source.kind !== 'user') continue
          const text = textBlocks(data)
          if (text === '') continue
          rows.push({ kind: 'user', key: `u${event.seq}`, text })
        } else if (event.type === 'assistant/message') {
          const text = textBlocks(data.message)
          if (text === '') continue
          rows.push({ kind: 'assistant', key: `a${event.seq}`, text, interrupted: data.interrupted === true })
        } else if (event.type === 'tool/call') {
          const row = {
            kind: 'tool',
            key: `c${event.seq}`,
            name: typeof data.name === 'string' && data.name !== '' ? data.name : 'tool',
            args: typeof data.arguments === 'string' ? data.arguments : '',
            result: '',
            status: 'running',
          }
          calls.set(String(data.callId ?? ''), row)
          rows.push(row)
        } else if (event.type === 'tool/result') {
          const message = data.message !== null && typeof data.message === 'object' ? data.message : {}
          const callId = String(message.toolCallId ?? '')
          const resultText = textBlocks(message)
          const failed = message.isError === true
          const row = calls.get(callId)
          if (row !== undefined) {
            row.status = failed ? 'error' : 'done'
            row.result = resultText
          } else {
            rows.push({ kind: 'tool', key: `r${event.seq}`, name: 'tool result', args: '', result: resultText, status: failed ? 'error' : 'done' })
          }
        } else if (event.type === 'turn/end') {
          const key = reasonKey(data.reason)
          if (key !== null) rows.push({ kind: 'notice', key: `e${event.seq}`, reasonKey: key })
        }
      }
      return rows.length > limit ? rows.slice(-limit) : rows
    }

    /** Latest human-readable title carried by `session/title` events in a window. */
    function titleFromEvents(entries) {
      if (!Array.isArray(entries)) return undefined
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry === null || entry === undefined || entry.type !== 'event' || !entry.event) continue
        if (entry.event.type !== 'session/title') continue
        const data = entry.event.data
        if (data !== null && typeof data === 'object' && typeof data.title === 'string' && data.title.trim() !== '') {
          return data.title.trim()
        }
      }
      return undefined
    }

    /**
     * The subagent entries one Session's projection publishes, newest first.
     *
     * @param listState - `SessionListState` (or anything shaped like it).
     * @param sessionId - the parent Session.
     * @returns `{ id, label, running }[]`, empty when unknown.
     */
    function subagentEntries(listState, sessionId) {
      if (listState === null || typeof listState !== 'object') return []
      const projections = listState.projectionsBySession
      if (projections === null || typeof projections !== 'object') return []
      const snapshot = projections[sessionId]
      const entries = snapshot === null || snapshot === undefined ? undefined : snapshot.values?.subagentCatalog
      if (!Array.isArray(entries)) return []
      const summaries = listState.byId !== null && typeof listState.byId === 'object' ? listState.byId : {}
      return entries.map((entry) => {
        if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') return null
        const summary = summaries[entry.id]
        const label = typeof entry.label === 'string' && entry.label.trim() !== ''
          ? entry.label.trim()
          : typeof summary?.title === 'string' && summary.title.trim() !== ''
            ? summary.title.trim()
            : entry.id.slice(0, 8)
        return { id: entry.id, label, running: summary?.running === true }
      }).filter((entry) => entry !== null)
    }

    /** The whole Session list snapshot, or undefined when unavailable. */
    function sessionListState(ctx) {
      try {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
        const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
        if (list === undefined || list === null || typeof list.getSnapshot !== 'function') return undefined
        return list.getSnapshot()
      } catch {
        return undefined
      }
    }

    /**
     * Session id → owning workspace (`{ key, label }`), from the Workspace
     * snapshot. `SessionSummary` carries no workspace field, so membership is
     * read from each workspace's `sessionIds`, and the label from its `title`
     * (falling back to the path's last segment).
     *
     * @param workspaceState - `useWorkspaces(…)` snapshot, when available.
     * @returns lookup table; empty when the snapshot is unavailable.
     */
    function workspaceIndex(workspaceState) {
      const index = {}
      if (workspaceState === null || workspaceState === undefined || typeof workspaceState !== 'object') return index
      const items = Array.isArray(workspaceState.items) ? workspaceState.items : []
      for (const workspace of items) {
        if (workspace === null || typeof workspace !== 'object') continue
        const workspaceId = String(workspace.workspaceId ?? workspace.id ?? '')
        if (workspaceId === '') continue
        const path = typeof workspace.path === 'string' ? workspace.path : ''
        const segments = path.split(/[\\/]+/u).filter((segment) => segment !== '')
        const label = typeof workspace.title === 'string' && workspace.title.trim() !== ''
          ? workspace.title.trim()
          : segments.length > 0 ? segments[segments.length - 1] : workspaceId.slice(0, 8)
        const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
        for (const sessionId of sessionIds) {
          if (typeof sessionId === 'string') index[sessionId] = { key: workspaceId, label }
        }
      }
      return index
    }

    /** Mark one pane as the live drop target without touching React state. */
    function setDomDropTarget(sessionId) {
      if (typeof document === 'undefined') return
      for (const node of Array.from(document.querySelectorAll('[data-ssp-pane][data-drop-target]'))) {
        if (sessionId === null || node.getAttribute('data-ssp-pane') !== sessionId) node.removeAttribute('data-drop-target')
      }
      if (sessionId === null || sessionId === '') return
      const target = document.querySelector(`[data-ssp-pane="${String(sessionId).replaceAll('"', '')}"]`)
      if (target !== null) target.setAttribute('data-drop-target', '')
    }

    /**
     * Preview a landing order with a FLIP animation.
     *
     * The panes are re-ordered with CSS `order` (no React render), then each
     * pane that moved is offset back to its old position and transitioned to
     * its new one, so neighbours visibly slide aside while the pointer moves.
     */
    function paintPaneOrder(order) {
      if (typeof document === 'undefined') return
      const nodes = Array.from(document.querySelectorAll('[data-ssp-pane]'))
      const before = new Map()
      for (const node of nodes) {
        before.set(node.getAttribute('data-ssp-pane'), node.getBoundingClientRect())
        node.style.transition = 'none'
        node.style.transform = 'none'
      }
      order.forEach((sessionId, index) => {
        const node = document.querySelector(`[data-ssp-pane="${String(sessionId).replaceAll('"', '')}"]`)
        if (node !== null) node.style.order = String(index)
      })
      for (const node of nodes) {
        const previous = before.get(node.getAttribute('data-ssp-pane'))
        if (previous === undefined) continue
        const next = node.getBoundingClientRect()
        const dx = previous.left - next.left
        const dy = previous.top - next.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
        node.style.transform = `translate(${dx}px, ${dy}px)`
      }
      // Force one style flush so the offset start positions are committed.
      void document.body.offsetWidth
      for (const node of nodes) {
        const previous = before.get(node.getAttribute('data-ssp-pane'))
        if (previous === undefined) continue
        node.style.transition = 'transform 190ms cubic-bezier(.2,.7,.2,1)'
        node.style.transform = 'none'
      }
    }

    /** Drop any preview order so the grid falls back to the stored list. */
    function clearPaneOrder() {
      if (typeof document === 'undefined') return
      for (const node of Array.from(document.querySelectorAll('[data-ssp-pane]'))) {
        node.style.removeProperty('order')
        node.style.removeProperty('transition')
        node.style.removeProperty('transform')
      }
    }

    /**
     * A `dsh-resource://file/session/…` address for one pane's file link.
     *
     * The right column resolves files from the *on-screen* Session, which a
     * global panel does not provide, so the pane hands the address over after
     * revealing the Conversation. See `dsh-util-workspace-path/file-address`.
     */
    function fileAddressFor(sessionId, rawPath) {
      const normalized = String(rawPath).replaceAll('\\', '/').replace(/^\/+/u, '')
      const encodeSegment = (segment) => encodeURIComponent(segment).replaceAll('%3A', ':')
      const path = normalized.split('/').map(encodeSegment).join('/')
      return `dsh-resource://file/session/${encodeURIComponent(String(sessionId))}/${path}`
    }

    /**
     * Leave the workbench for the native Conversation and open the file there.
     *
     * The click is consumed because the right column's write path throws while a
     * global panel owns the main column; the native page has the Session on
     * screen, so the same open succeeds.
     */
    function openFileOnNativePage(ctx, sessionId, rawPath) {
      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      const sidebarRight = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined
      if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.openSession !== 'function') return false
      // Leaving for the native page collapses the workbench, like any other
      // jump away from it, so the floating bar is there to come back to.
      if (paneStore.panes.length > 0) setMinimized(true)
      try {
        uiWorkspace.openSession(sessionId)
      } catch (error) {
        console.warn('[session-split] revealing the Session failed:', error)
        return false
      }
      let attempts = 0
      const open = () => {
        attempts += 1
        let panel
        try {
          panel = layout !== undefined && layout !== null && layout.panelInfo !== undefined && typeof layout.panelInfo.getSnapshot === 'function'
            ? layout.panelInfo.getSnapshot()
            : undefined
        } catch { /* treated as not revealed yet */ }
        if (panel !== undefined && panel.activePanelId === null) {
          // The right column learns its Session from a layout subscription; give
          // it a beat after the panel flips, and retry once if it is not there.
          const attemptOpen = (retry) => {
            try {
              if (sidebarRight !== undefined && sidebarRight !== null && typeof sidebarRight.openResource === 'function') {
                sidebarRight.openResource(fileAddressFor(sessionId, rawPath))
              }
            } catch (error) {
              if (retry) window.setTimeout(() => attemptOpen(false), 400)
              else console.warn('[session-split] opening the file on the native page failed:', error)
            }
          }
          window.setTimeout(() => attemptOpen(true), 180)
          return
        }
        if (attempts < 60) window.setTimeout(open, 50)
      }
      window.setTimeout(open, 80)
      return true
    }

    /** A lightweight card that follows the pointer while a pane is dragged. */
    let dragGhost = null
    function showDragGhost(label, x, y) {
      if (typeof document === 'undefined') return
      if (dragGhost === null) {
        dragGhost = document.createElement('div')
        dragGhost.className = 'ssp-drag-ghost'
        document.body.appendChild(dragGhost)
      }
      dragGhost.textContent = label
      dragGhost.style.left = `${x}px`
      dragGhost.style.top = `${y}px`
    }
    function hideDragGhost() {
      if (dragGhost !== null) {
        dragGhost.remove()
        dragGhost = null
      }
    }

    /** A 1x1 transparent image, used to suppress the browser's drag ghost. */
    function blankDragImage() {
      try {
        const image = new Image()
        image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        return image
      } catch {
        return undefined
      }
    }

    /** The Session id a sidebar row key names, or null. */
    function sessionIdFromRowKey(key) {
      if (typeof key !== 'string' || !key.startsWith('session:')) return null
      const id = key.slice('session:'.length)
      return id === '' ? null : id
    }

    /** Normalize a stored pane list: strings only, no duplicates, bounded. */
    function normalizePanes(list) {
      if (!Array.isArray(list)) return []
      const seen = new Set()
      const panes = []
      for (const value of list) {
        if (typeof value !== 'string' || value === '') continue
        if (seen.has(value)) continue
        seen.add(value)
        panes.push(value)
        if (panes.length >= MAX_PANES) break
      }
      return panes
    }

    /** Add one Session id to a pane list, returning a new array when it changes. */
    function addPane(list, sessionId) {
      const panes = normalizePanes(list)
      if (typeof sessionId !== 'string' || sessionId === '') return panes
      if (panes.includes(sessionId)) return panes
      if (panes.length >= MAX_PANES) panes.shift()
      panes.push(sessionId)
      return panes
    }

    /** Remove one pane from a list. */
    function removePane(list, sessionId) {
      return normalizePanes(list).filter((value) => value !== sessionId)
    }

    /**
     * Move one pane to another position (a reorder), keeping every other pane.
     *
     * @param list - current pane ids.
     * @param fromIndex - index being dragged.
     * @param toIndex - destination index in the resulting list.
     * @returns the reordered list, or the same array when nothing moves.
     */
    function movePane(list, fromIndex, toIndex) {
      const panes = normalizePanes(list)
      if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return panes
      if (fromIndex < 0 || fromIndex >= panes.length) return panes
      let target = toIndex
      if (target < 0) target = 0
      if (target > panes.length - 1) target = panes.length - 1
      if (target === fromIndex) return panes
      const next = panes.slice()
      const [moved] = next.splice(fromIndex, 1)
      next.splice(target, 0, moved)
      return next
    }

    /** The column count an automatic grid uses for a pane count. */
    function autoColumns(count) {
      if (count <= 1) return 1
      if (count === 2) return 2
      if (count === 3) return 3
      if (count === 4) return 2
      return 3
    }

    /**
     * Even column widths for a column count.
     *
     * @param columns - grid column count (>= 1).
     * @returns one normalized fraction per column.
     */
    function equalWidths(columns) {
      const count = Math.max(1, Math.floor(Number(columns) || 1))
      return Array.from({ length: count }, () => 1 / count)
    }

    /**
     * Normalize persisted column widths against the current column count.
     *
     * A width list that does not match the column count (or a corrupt one) is
     * replaced by an even split, so a stale layout can never squash a column.
     *
     * @param widths - stored fractions.
     * @param columns - grid column count.
     * @param min - smallest allowed fraction for one column.
     * @returns fractions summing to 1, one per column.
     */
    function normalizeWidths(widths, columns, min) {
      const count = Math.max(1, Math.floor(Number(columns) || 1))
      if (count === 1) return [1]
      const floor = typeof min === 'number' && min > 0 ? min : 0.12
      if (!Array.isArray(widths) || widths.length !== count) return equalWidths(count)
      const cleaned = widths.map((value) => {
        const number = Number(value)
        return Number.isFinite(number) && number > 0 ? number : 0
      })
      const sum = cleaned.reduce((total, value) => total + value, 0)
      if (!(sum > 0)) return equalWidths(count)
      const normalized = cleaned.map((value) => value / sum)
      if (normalized.some((value) => value < floor * 0.5)) return equalWidths(count)
      return normalized
    }

    /** The left percentage of each internal column divider. */
    function gutterOffsets(widths) {
      const offsets = []
      let accumulated = 0
      for (let index = 0; index < widths.length - 1; index += 1) {
        accumulated += widths[index]
        offsets.push(accumulated * 100)
      }
      return offsets
    }

    /**
     * Grid shape for a pane count and an optional manual column override.
     *
     * @param count - number of panes.
     * @param override - 2/3/4 to pin the column count, anything else for auto.
     * @returns `{ columns, rows }`.
     */
    function planGrid(count, override) {
      const safe = Math.max(0, Math.min(MAX_PANES, Math.floor(Number(count) || 0)))
      if (safe === 0) return { columns: 1, rows: 1 }
      const manual = override === 2 || override === 3 || override === 4 ? override : 0
      const columns = Math.min(manual > 0 ? manual : autoColumns(safe), safe)
      return { columns, rows: Math.ceil(safe / columns) }
    }

    // ---------------------------------------------------------------------
    // Workbench state
    // ---------------------------------------------------------------------

    /** Persisted workbench state, read once per page load. */
    function readPersistedState() {
      const empty = { panes: [], columns: 0, widths: [], minimized: false, bar: null, followOpened: true, compactComposer: false, workbenchOpen: false }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (typeof raw !== 'string' || raw === '') return empty
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return empty
        const columns = parsed.columns === 2 || parsed.columns === 3 || parsed.columns === 4 ? parsed.columns : 0
        const bar = parsed.bar !== null && typeof parsed.bar === 'object'
          && Number.isFinite(Number(parsed.bar.left)) && Number.isFinite(Number(parsed.bar.top))
          ? { left: Number(parsed.bar.left), top: Number(parsed.bar.top) }
          : null
        return {
          panes: normalizePanes(parsed.panes),
          columns,
          widths: Array.isArray(parsed.widths) ? parsed.widths.map((value) => Number(value)).filter((value) => Number.isFinite(value)) : [],
          minimized: parsed.minimized === true,
          bar,
          followOpened: parsed.followOpened !== false,
          compactComposer: parsed.compactComposer === true,
          workbenchOpen: parsed.workbenchOpen === true,
        }
      } catch {
        return empty
      }
    }

    /** Pane list, column override, widths, minimised state, and their subscribers. */
    const persistedState = readPersistedState()
    const paneStore = {
      panes: persistedState.panes,
      columns: persistedState.columns,
      widths: persistedState.widths,
      minimized: persistedState.minimized,
      bar: persistedState.bar,
      followOpened: persistedState.followOpened,
      compactComposer: persistedState.compactComposer,
      // The workbench no longer occupies a main panel: it is an overlay shown
      // on top of the Conversation, so `sidebarRight` still sees a Session on
      // screen (file opening, right column) while the split view is visible.
      workbenchOpen: persistedState.workbenchOpen,
      flash: null,
      listeners: new Set(),
    }

    /** Write the workbench state to storage. */
    function persistState() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          panes: paneStore.panes,
          columns: paneStore.columns,
          widths: paneStore.widths,
          minimized: paneStore.minimized,
          bar: paneStore.bar,
          followOpened: paneStore.followOpened,
          compactComposer: paneStore.compactComposer,
          workbenchOpen: paneStore.workbenchOpen,
        }))
      } catch {
        /* a locked profile keeps the state for this page only */
      }
    }

    /** Notify every mounted workbench surface. */
    function notifyPanes() {
      for (const listener of Array.from(paneStore.listeners)) listener()
    }

    /** Persist and publish the workbench state. */
    function commit(next) {
      paneStore.panes = normalizePanes(next.panes ?? paneStore.panes)
      paneStore.columns = next.columns ?? paneStore.columns
      paneStore.widths = next.widths ?? paneStore.widths
      paneStore.minimized = next.minimized ?? paneStore.minimized
      paneStore.bar = next.bar !== undefined ? next.bar : paneStore.bar
      paneStore.followOpened = next.followOpened !== undefined ? next.followOpened : paneStore.followOpened
      paneStore.compactComposer = next.compactComposer !== undefined ? next.compactComposer : paneStore.compactComposer
      paneStore.workbenchOpen = next.workbenchOpen !== undefined ? next.workbenchOpen : paneStore.workbenchOpen
      persistState()
      notifyPanes()
    }

    /** Replace the pane list. */
    function setPanes(panes) {
      commit({ panes })
    }

    /** Pin or clear the manual column override; a new shape starts even. */
    function setColumns(columns) {
      const grid = planGrid(paneStore.panes.length, columns)
      commit({ panes: paneStore.panes, columns, widths: equalWidths(grid.columns) })
    }

    /** Live column widths while dragging a divider (persisted on release). */
    function setWidths(widths, persist) {
      const grid = planGrid(paneStore.panes.length, paneStore.columns)
      paneStore.widths = normalizeWidths(widths, grid.columns)
      if (persist === true) persistState()
      notifyPanes()
    }

    /** Shrink the workbench into the floating bar (or bring it back). */
    function setMinimized(minimized) {
      commit({ panes: paneStore.panes, minimized: minimized === true })
    }

    /** Remember where the floating bar sits. */
    function setBarPosition(left, top) {
      commit({ panes: paneStore.panes, bar: { left: Math.round(left), top: Math.round(top) } })
    }

    /** Turn the "clicking an already-open Session highlights it" behaviour on or off. */
    function setFollowOpened(value) {
      commit({ panes: paneStore.panes, followOpened: value === true })
    }

    /** Collapse every pane's composer to a single line, or restore it. */
    function setCompactComposer(value) {
      commit({ panes: paneStore.panes, compactComposer: value === true })
    }

    /** Show or hide the workbench overlay (it sits above the Conversation). */
    function setWorkbenchOpen(value) {
      commit({ panes: paneStore.panes, workbenchOpen: value === true })
    }

    /** One run of the "already open" hint on one pane. */
    let flashTimer = null
    function flashPane(sessionId) {
      paneStore.flash = sessionId
      notifyPanes()
      if (flashTimer !== null) window.clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => {
        flashTimer = null
        paneStore.flash = null
        notifyPanes()
      }, 1600)
    }

    /** Subscribe to the workbench state. */
    function usePanes() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        paneStore.listeners.add(listener)
        return () => {
          paneStore.listeners.delete(listener)
        }
      }, [])
      return {
        panes: paneStore.panes,
        columns: paneStore.columns,
        widths: paneStore.widths,
        minimized: paneStore.minimized,
        bar: paneStore.bar,
        followOpened: paneStore.followOpened,
        compactComposer: paneStore.compactComposer,
        workbenchOpen: paneStore.workbenchOpen,
        flash: paneStore.flash,
      }
    }

    /** Drag state shared by the overlay hint and the drop handlers. */
    const dragStore = {
      kind: null,
      sessionId: null,
      overPane: null,
      zone: null,
      previewIndex: null,
      // Geometry captured at dragstart: the preview itself changes the layout,
      // so hit-testing against live rects would feed back and flicker.
      paneRects: null,
      listeners: new Set(),
    }

    /** Replace drag state, notifying only when a visible field changed. */
    function setDrag(patch) {
      let changed = false
      for (const key of Object.keys(patch)) {
        if (dragStore[key] !== patch[key]) changed = true
        dragStore[key] = patch[key]
      }
      if (!changed) return
      for (const listener of Array.from(dragStore.listeners)) listener()
    }

    /** Subscribe to the drag state. */
    function useDragState() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        dragStore.listeners.add(listener)
        return () => {
          dragStore.listeners.delete(listener)
        }
      }, [])
      return dragStore
    }

    /** The last Session the main Conversation column showed, remembered across panel switches. */
    let lastMainSessionId = undefined

    /** Subscribers told whenever that remembered Session changes. */
    const currentStore = { listeners: new Set() }

    /** Record the Session the user is looking at, and wake the workbench. */
    function setCurrentSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (sessionId === lastMainSessionId) return
      lastMainSessionId = sessionId
      for (const listener of Array.from(currentStore.listeners)) listener()
    }

    /** The Session the main Conversation column currently shows, if any. */
    function currentSessionId(ctx) {
      try {
        const state = sessionListState(ctx)
        const byId = state !== null && state !== undefined ? state.byId : undefined
        if (byId === undefined || byId === null) return undefined
        for (const summary of Object.values(byId)) {
          if (summary === null || summary === undefined) continue
          if ((summary.retainedBy?.mainView ?? 0) > 0) return summary.id
        }
      } catch {
        return undefined
      }
      return undefined
    }

    /**
     * The Session "Add current conversation" should offer.
     *
     * Selecting this panel unmounts the Conversation column, so the main-view
     * retention disappears exactly while the workbench is on screen; the last
     * value seen is kept instead.
     */
    function resolveCurrentSession(ctx) {
      const live = currentSessionId(ctx)
      if (live !== undefined) {
        setCurrentSession(live)
        return live
      }
      return lastMainSessionId
    }

    /** The remembered Session, re-read whenever it changes. */
    function useCurrentSession(ctx) {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        currentStore.listeners.add(listener)
        return () => {
          currentStore.listeners.delete(listener)
        }
      }, [])
      return resolveCurrentSession(ctx)
    }

    /** Remember the main-view Session whenever the list names one. */
    function rememberCurrentSession(ctx) {
      const sync = () => {
        resolveCurrentSession(ctx)
      }
      sync()
      try {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
        const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
        if (list === undefined || list === null || typeof list.subscribe !== 'function') return undefined
        return list.subscribe(sync)
      } catch {
        return undefined
      }
    }

    /** Read one Session title out of the sidebar list snapshot. */
    function sessionTitle(ctx, sessionId) {
      try {
        const state = sessionListState(ctx)
        const summary = state !== null && state !== undefined ? state.byId?.[sessionId] : undefined
        if (summary !== null && summary !== undefined && typeof summary.title === 'string' && summary.title.trim() !== '') {
          return summary.title.trim()
        }
      } catch {
        return undefined
      }
      return undefined
    }

    /** Open one Session in the shipped Conversation panel. */
    function openNative(ctx, sessionId) {
      const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      try {
        if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
          workspace.openSession(sessionId)
        }
      } catch (error) {
        console.warn('[session-split] openSession failed:', error)
      }
      try {
        if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(null)
      } catch (error) {
        console.warn('[session-split] selectPanel(null) failed:', error)
      }
    }

    /** Show the workbench, adding `sessionId` when given. */
    function openWorkbench(ctx, sessionId) {
      if (typeof sessionId === 'string' && sessionId !== '') setPanes(addPane(paneStore.panes, sessionId))
      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      try {
        if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
      } catch (error) {
        console.warn('[session-split] selectPanel failed:', error)
      }
    }

    // ---------------------------------------------------------------------
    // Observation hooks over the Session binding
    // ---------------------------------------------------------------------

    /** Subscribe to an ObservableSnapshot, tolerating an absent source. */
    function useObserved(source) {
      const [snapshot, setSnapshot] = useState(() => (source ? source.getSnapshot() : undefined))
      useEffect(() => {
        if (!source) {
          setSnapshot(undefined)
          return undefined
        }
        setSnapshot(source.getSnapshot())
        return source.subscribe(() => setSnapshot(source.getSnapshot()))
      }, [source])
      return snapshot
    }

    /**
     * Acknowledge a Session's "finished, unseen" dot.
     *
     * The status store clears `completionUnread` while the Session is retained
     * by the main view, so the workbench borrows that reference for a moment and
     * releases it. Debounced per Session so focusing a pane repeatedly (typing,
     * clicking, switching) does not keep borrowing references.
     */
    const acknowledgedAt = new Map()
    function acknowledgeCompletion(ctx, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      const now = Date.now()
      const last = acknowledgedAt.get(sessionId)
      if (typeof last === 'number' && now - last < 1500) return
      acknowledgedAt.set(sessionId, now)
      const sessions = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      if (sessions === undefined || sessions === null || typeof sessions.retain !== 'function') return
      try {
        const reference = sessions.retain(sessionId, { source: 'mainView' })
        window.setTimeout(() => {
          try {
            reference.release()
          } catch { /* already released */ }
        }, 600)
      } catch (error) {
        console.warn('[session-split] acknowledging the completion dot failed:', error)
      }
    }

    /**
     * Retained Session references, owned by the plugin rather than by a pane.
     *
     * A pane component unmounts whenever the panel is left (minimise, or opening
     * another Session), and releasing there would force a fresh history load on
     * the way back. Keeping the reference alive across remounts is what makes
     * returning to the workbench instant; it is released on remove pane, clear,
     * and plugin unload.
     */
    const retainCache = new Map()

    /** Acquire (or reuse) the reference and binding for one Session. */
    function acquireSession(ctx, sessionId) {
      const cached = retainCache.get(sessionId)
      if (cached !== undefined) return cached
      const sessions = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      if (sessions === undefined || sessions === null || typeof sessions.retain !== 'function') {
        const entry = { reference: null, binding: null, error: translate(ctx, 'pane.failed'), promise: Promise.reject(new Error('sessions unavailable')) }
        retainCache.set(sessionId, entry)
        return entry
      }
      const entry = { reference: null, binding: null, error: null, promise: null }
      try {
        entry.reference = sessions.retain(sessionId, { source: 'controllerOperation' })
      } catch (error) {
        entry.error = String((error && error.message) || error)
        entry.promise = Promise.reject(error)
        retainCache.set(sessionId, entry)
        return entry
      }
      entry.promise = Promise.resolve(entry.reference.ready).then((binding) => {
        entry.binding = binding
        return binding
      }).catch((error) => {
        entry.error = String((error && error.message) || error)
        throw error
      })
      retainCache.set(sessionId, entry)
      return entry
    }

    /** Drop one cached Session reference (pane removed, retry, clearing). */
    function releaseSession(sessionId) {
      const entry = retainCache.get(sessionId)
      if (entry === undefined) return
      retainCache.delete(sessionId)
      try {
        if (entry.reference !== null) entry.reference.release()
      } catch (error) {
        console.warn('[session-split] release failed:', error)
      }
    }

    /** Drop every cached reference (clear the workbench, plugin unload). */
    function releaseAllSessions() {
      for (const sessionId of Array.from(retainCache.keys())) releaseSession(sessionId)
    }

    /**
     * One pane's view of a cached Session binding.
     *
     * The effect never releases on unmount — that is the point: the reference
     * outlives the panel and the next mount reuses the settled binding.
     */
    function useRetainedSession(sessionId) {
      const [state, setState] = useState(() => {
        const cached = retainCache.get(sessionId)
        if (cached !== undefined && cached.binding !== null && cached.binding !== undefined) {
          return { status: 'ready', binding: cached.binding, reference: cached.reference, error: null, attempt: 0 }
        }
        return { status: 'loading', binding: null, reference: null, error: null, attempt: 0 }
      })
      const retry = useCallback(() => {
        releaseSession(sessionId)
        setState((previous) => ({ ...previous, status: 'loading', binding: null, reference: null, error: null, attempt: previous.attempt + 1 }))
      }, [sessionId])
      useEffect(() => {
        const ctx = ctxRef.current
        if (ctx === null || typeof sessionId !== 'string' || sessionId === '') return undefined
        let disposed = false
        const entry = acquireSession(ctx, sessionId)
        if (entry.binding !== null && entry.binding !== undefined) {
          setState((previous) => ({ ...previous, status: 'ready', binding: entry.binding, reference: entry.reference, error: null }))
          return undefined
        }
        if (entry.error !== null && entry.error !== undefined) {
          setState((previous) => ({ ...previous, status: 'error', error: entry.error }))
          return undefined
        }
        setState((previous) => ({ ...previous, status: 'loading', error: null }))
        Promise.resolve(entry.promise).then((binding) => {
          if (disposed) return
          setState((previous) => ({ ...previous, status: 'ready', binding, reference: entry.reference, error: null }))
        }).catch((error) => {
          if (disposed) return
          setState((previous) => ({ ...previous, status: 'error', error: String((error && error.message) || error) }))
        })
        return () => {
          disposed = true
        }
      }, [sessionId, state.attempt])
      return { ...state, retry }
    }

    /** Deliver one text prompt through the public Session API (fallback composer). */
    function promptSession(binding, text) {
      return Promise.resolve(binding.session.prompt([{ type: 'text', text }], 'queue')).then((result) => {
        if (result !== null && result !== undefined && result.ok === false) {
          const failure = result.error
          throw new Error(failure !== null && failure !== undefined ? String(failure.message || failure.code || failure) : 'refused')
        }
        return result
      })
    }

    // ---------------------------------------------------------------------
    // Markdown (fallback reading renderer only)
    // ---------------------------------------------------------------------

    /** Render inline `code`, **bold**, and [links](…) inside one text run. */
    function renderInline(text, prefix) {
      const nodes = []
      const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))/gu
      let last = 0
      let index = 0
      let match = pattern.exec(text)
      while (match !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          nodes.push(h('code', { key: `${prefix}-c${index}` }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          nodes.push(h('strong', { key: `${prefix}-b${index}` }, token.slice(2, -2)))
        } else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token)
          nodes.push(h('a', {
            key: `${prefix}-a${index}`,
            href: link !== null ? link[2] : undefined,
            target: '_blank',
            rel: 'noreferrer noopener',
          }, link !== null ? link[1] : token))
        }
        last = match.index + token.length
        index += 1
        match = pattern.exec(text)
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** Render a Markdown string into block elements. */
    function renderMarkdown(text, prefix) {
      const lines = String(text).split('\n')
      const blocks = []
      let paragraph = []
      let block = 0
      let index = 0
      const flush = () => {
        if (paragraph.length === 0) return
        const key = `${prefix}-p${block++}`
        blocks.push(h('p', { key }, renderInline(paragraph.join(' '), key)))
        paragraph = []
      }
      while (index < lines.length) {
        const line = lines[index]
        if (/^\s*```/u.test(line)) {
          flush()
          const code = []
          index += 1
          while (index < lines.length && !/^\s*```/u.test(lines[index])) {
            code.push(lines[index])
            index += 1
          }
          index += 1
          blocks.push(h('pre', { key: `${prefix}-pre${block++}` }, h('code', null, code.join('\n'))))
          continue
        }
        if (/^\s*$/u.test(line)) {
          flush()
          index += 1
          continue
        }
        const heading = /^\s*(#{1,6})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          flush()
          const key = `${prefix}-h${block++}`
          blocks.push(h('div', { key, className: 'ssp-md-heading' }, renderInline(heading[2], key)))
          index += 1
          continue
        }
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/u.exec(line)
        if (item !== null) {
          flush()
          const key = `${prefix}-li${block++}`
          blocks.push(h('div', { key, className: 'ssp-md-item' }, renderInline(item[2], key)))
          index += 1
          continue
        }
        const quote = /^\s*>\s?(.*)$/u.exec(line)
        if (quote !== null) {
          flush()
          const key = `${prefix}-q${block++}`
          blocks.push(h('div', { key, className: 'ssp-md-quote' }, renderInline(quote[1], key)))
          index += 1
          continue
        }
        if (/^\s*(-{3,}|\*{3,})\s*$/u.test(line)) {
          flush()
          blocks.push(h('hr', { key: `${prefix}-hr${block++}` }))
          index += 1
          continue
        }
        paragraph.push(line.trim())
        index += 1
      }
      flush()
      return blocks
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    /** Workbench stylesheet, expressed only through host theme tokens. */
    const CSS = [
      '.ssp-root{flex:1 1 auto;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden}',
      '.ssp-host{position:fixed;z-index:5;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}',
      '.ssp-host{position:fixed;z-index:5;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}',
      '.ssp-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:10px;min-height:42px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.ssp-toolbar-title{font-weight:600;font-size:13px;line-height:20px}',
      '.ssp-toolbar-count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}',
      '.ssp-toolbar-spacer{flex:1 1 auto}',
      '.ssp-columns{display:flex;align-items:center;gap:2px;height:26px;padding:1px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px}',
      '.ssp-columns-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);padding:0 5px}',
      '.ssp-col-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;height:22px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:5px;padding:0 7px;font:inherit;font-size:11.5px;line-height:16px;cursor:pointer}',
      '.ssp-col-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-col-btn[data-active]{background:var(--dsw-alias-state-business-primary);color:#fff}',
      '.ssp-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer;line-height:18px}',
      '.ssp-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ssp-btn[disabled]{opacity:.45;cursor:default}',
      '.ssp-btn[data-active]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}',
      '.ssp-btn-primary{background:var(--dsw-alias-button-info-fill);border-color:transparent;color:#fff}',
      '.ssp-btn-primary:hover{background:var(--dsw-alias-button-info-hover);color:#fff}',
      '.ssp-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
      '.ssp-empty-title{font-size:14px;color:var(--dsw-alias-label-secondary)}',
      '.ssp-empty-hint{max-width:440px;line-height:20px;font-size:12.5px}',
      '.ssp-grid{flex:1 1 auto;min-height:0;display:grid;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 70%,#000);padding:6px;position:relative}',
      '.ssp-grid[data-dropping="panel"]{outline:2px dashed var(--dsw-alias-state-business-primary);outline-offset:-3px}',
      '.ssp-gutter{position:absolute;top:0;bottom:0;width:11px;transform:translateX(-50%);cursor:col-resize;z-index:4;touch-action:none;border-radius:2px;background:transparent}',
      '.ssp-gutter:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent)}',
      '.ssp-gutter:active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent)}',
      '.ssp-root{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}',
      '.ssp-pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base);overflow:hidden;position:relative;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 65%,transparent)}',
      '.ssp-pane-preview{display:flex;flex-direction:row;align-items:center;justify-content:center;border:1.5px dashed var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.ssp-pane-preview-label{flex:0 0 auto;text-align:center;font-size:12.5px;line-height:18px;pointer-events:none}',
      '.ssp-pane[data-drop-target]::after{content:"";position:absolute;inset:0;border:2px dashed var(--dsw-alias-state-business-primary);pointer-events:none;z-index:9}',
      '.ssp-pane[data-dragging]{opacity:.62;filter:saturate(.75);transition:opacity 120ms ease}',
      '.ssp-pane[data-dragging]::after{content:"";position:absolute;inset:0;border:2px dashed var(--dsw-alias-state-business-primary);pointer-events:none;z-index:9}',
      '.ssp-drag-ghost{position:fixed;z-index:2147483003;pointer-events:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 12px;border-radius:9px;background:var(--dsw-alias-bg-overlay,#22262e);border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-shadow:0 10px 24px rgba(0,0,0,.45);transform:translate(-50%,-50%)}',
      '.ssp-pane>*{min-width:0;min-height:0}',
      '.ssp-pane>*:not(.ssp-pane-head):not(.ssp-subagents):not(.ssp-composer):not(.ssp-error):not(.ssp-compact-bar){flex:1 1 auto;min-height:0;overflow:hidden}',
      // A definite height chain for the shipped body: without it the body can
      // grow to content height inside a flex cell, which pushes its sticky
      // composer past the visible area (the "no input box" symptom).
      // A definite height for the shipped body, kept as a plain flex column.
      '.ssp-body{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      '.ssp-body>*{flex:1 1 auto;min-width:0;min-height:0}',
      // Compact composer: a placeholder bar laid over the pane's bottom edge.
      // It is absolutely positioned so showing/hiding it never re-flows the
      // message list — only opacity animates, which is what keeps it steady.
      '.ssp-pane[data-collapsed] [data-composer-card]{display:none}',
      '.ssp-pane[data-collapsed] [data-composer-dock]{display:none}',
      '.ssp-pane[data-collapsed] [data-conversation-content]{padding-bottom:44px}',
      '.ssp-host:not([data-over-composer]) .ssp-root[data-session-drag] .ssp-pane [data-composer-card]{outline:none !important;box-shadow:none !important}',
      '.ssp-paste-notice{flex:0 0 auto;margin:0 8px 6px;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,#d7a12a) 16%,transparent);color:var(--dsw-alias-label-primary);font-size:11.5px;line-height:16px}',
      '.ssp-compact-bar{position:absolute;left:8px;right:8px;bottom:6px;z-index:3;appearance:none;display:flex;align-items:center;gap:8px;height:34px;box-sizing:border-box;padding:0 12px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,transparent);color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:text;opacity:.62;transition:opacity 130ms ease,background-color 130ms ease,color 130ms ease;animation:ssp-bar-in 130ms ease}',
      '.ssp-compact-bar:hover{opacity:.95;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-compact-bar-shrink{opacity:0;pointer-events:none}',
      '.ssp-compact-bar-icon{display:inline-flex;flex:0 0 auto;opacity:.8}',
      '.ssp-compact-bar-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-pane[data-compact]:not([data-collapsed]) [data-composer-card]{animation:ssp-composer-reveal 170ms cubic-bezier(.2,.7,.2,1)}',
      // clip-path reveals the composer from its bottom edge without re-flowing
      // anything, which reads as the bar growing into the real input.
      '@keyframes ssp-composer-reveal{from{clip-path:inset(55% 0 0 0);opacity:.55}to{clip-path:inset(0 0 0 0);opacity:1}}',
      '@keyframes ssp-bar-in{from{opacity:0;transform:translateY(10px)}to{opacity:.62;transform:none}}',
      '@media (prefers-reduced-motion:reduce){.ssp-compact-bar,.ssp-pane[data-compact]:not([data-collapsed]) [data-composer-card]{animation:none;transition:none}}',
      '.ssp-pane-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:10px 10px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 55%,transparent);background:transparent;cursor:grab;user-select:none}',
      '.ssp-pane-head:active{cursor:grabbing}',
      '.ssp-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}',
      '.ssp-dot[data-state="running"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent);animation:ssp-pulse 1.6s ease-in-out infinite}',
      '.ssp-dot[data-state="unread"]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,transparent)}',
      '@keyframes ssp-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '.ssp-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary)}',
      '.ssp-pane-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px;font-weight:600;letter-spacing:.01em}',
      '.ssp-icon-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:1px 4px;border-radius:5px;font-size:12px;line-height:16px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center}',
      '.ssp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ssp-icon-btn:disabled{opacity:.4;cursor:default;background:transparent}',
      '.ssp-icon-btn[data-active]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}',
      '.ssp-icon-btn svg{display:block}',
      '.ssp-icon-btn-lg{width:26px;height:24px;padding:0}',
      '.ssp-chips{display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0;overflow:hidden}',
      '.ssp-chip{appearance:none;display:inline-flex;align-items:center;gap:4px;max-width:120px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 6px;font:inherit;font-size:10.5px;line-height:16px;cursor:pointer;flex:0 1 auto;min-width:0}',
      '.ssp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ssp-chip-more{flex:0 0 auto;font-variant-numeric:tabular-nums}',
      '.ssp-chip-count{flex:0 0 auto;font-variant-numeric:tabular-nums}',
      '.ssp-pane-flash{position:relative;z-index:2}',
      '.ssp-pane-flash::after{content:"";position:absolute;inset:0;border:2px solid var(--dsw-alias-state-business-primary);pointer-events:none;z-index:9;animation:ssp-flash-out 1.6s ease-out forwards}',
      '@keyframes ssp-flash-out{0%{opacity:1}70%{opacity:1}100%{opacity:0}}',
      '.ssp-chip-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}',
      '.ssp-chip[data-running="running"] .ssp-chip-dot{background:var(--dsw-alias-state-success-primary)}',
      '.ssp-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-menu{position:fixed;z-index:2147483000;min-width:170px;max-width:280px;max-height:300px;overflow:auto;padding:4px;border-radius:9px;background:var(--dsw-alias-bg-overlay,#22262e);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 28px rgba(0,0,0,.35)}',
      '.ssp-menu-item{appearance:none;display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;padding:5px 8px;border-radius:6px;cursor:pointer}',
      '.ssp-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-menu-item-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-picker{position:fixed;z-index:2147483001;width:330px;max-height:460px;display:flex;flex-direction:column;border-radius:10px;background:var(--dsw-alias-bg-overlay,#22262e);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.42);overflow:hidden}',
      '.ssp-picker-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.ssp-picker-search{flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:5px 8px;outline:none}',
      '.ssp-picker-toggle{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;user-select:none}',
      '.ssp-picker-toggle input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}',
      '.ssp-picker-group{margin-bottom:2px}',
      '.ssp-picker-group-head{position:sticky;top:0;z-index:1;padding:4px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-overlay,#22262e)}',
      '.ssp-picker-search:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.ssp-picker-list{flex:1 1 auto;min-height:0;overflow:auto;padding:4px}',
      '.ssp-picker-row{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}',
      '.ssp-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-picker-row input{margin:0;accent-color:var(--dsw-alias-state-business-primary)}',
      '.ssp-picker-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-picker-empty{padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.ssp-picker-foot{display:flex;gap:8px;justify-content:flex-end;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.ssp-bar{position:fixed;z-index:2147483002;display:flex;align-items:center;gap:2px;padding:4px 6px 4px 8px;border-radius:11px;background:var(--dsw-alias-bg-overlay,#22262e);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 26px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary);font-size:12px;cursor:grab;user-select:none}',
      '.ssp-bar:active{cursor:grabbing}',
      '.ssp-bar-main{appearance:none;display:flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:3px 5px;border-radius:7px}',
      '.ssp-bar-main:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-bar-count{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.ssp-bar-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px 7px;border-radius:7px;font:inherit;font-size:12px;line-height:18px}',
      '.ssp-bar-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.ssp-transcript{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:12px 12px 4px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin}',
      '.ssp-row-user{align-self:flex-end;max-width:88%;background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary);border-radius:10px;padding:7px 10px;white-space:pre-wrap;word-break:break-word;line-height:19px}',
      '.ssp-row-assistant{align-self:stretch;line-height:19.5px;color:var(--dsw-alias-label-primary);word-break:break-word}',
      '.ssp-row-assistant p{margin:0 0 7px}',
      '.ssp-row-assistant p:last-child{margin-bottom:0}',
      '.ssp-row-assistant pre{margin:7px 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-markdown-code-block);overflow-x:auto;font-size:12px;line-height:17px}',
      '.ssp-row-assistant code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
      '.ssp-row-assistant pre code{background:none;padding:0}',
      '.ssp-md-heading{font-weight:600;margin:8px 0 4px}',
      '.ssp-md-item{padding-left:14px;position:relative;margin:2px 0}',
      '.ssp-md-item::before{content:"•";position:absolute;left:2px;color:var(--dsw-alias-label-tertiary)}',
      '.ssp-md-quote{border-left:2px solid var(--dsw-alias-border-l2);padding-left:8px;color:var(--dsw-alias-label-secondary);margin:4px 0}',
      '.ssp-tool{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.ssp-tool-head{appearance:none;border:0;background:transparent;color:inherit;font:inherit;width:100%;text-align:left;display:flex;align-items:center;gap:7px;padding:6px 9px;cursor:pointer;font-size:12px}',
      '.ssp-tool-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-tool-name{font-weight:600;flex:0 0 auto;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-tool-summary{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.ssp-tool-status{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-state-idle-primary)}',
      '.ssp-tool[data-status="done"] .ssp-tool-status{color:var(--dsw-alias-state-success-primary)}',
      '.ssp-tool[data-status="error"] .ssp-tool-status{color:var(--dsw-alias-state-error-primary)}',
      '.ssp-tool-body{margin:0;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font-size:11.5px;line-height:16px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word}',
      '.ssp-notice{font-size:11.5px;color:var(--dsw-alias-label-tertiary);text-align:center}',
      '.ssp-more{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:center;padding:2px 0 6px}',
      '.ssp-pending{align-self:flex-end;max-width:88%;background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-secondary);border-radius:10px;padding:7px 10px;white-space:pre-wrap;word-break:break-word;line-height:19px;opacity:.72}',
      '.ssp-composer{flex:0 0 auto;display:flex;align-items:flex-end;gap:7px;padding:8px 10px 10px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.ssp-input{flex:1 1 auto;min-width:0;resize:none;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;padding:6px 9px;max-height:120px;outline:none}',
      '.ssp-input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.ssp-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.ssp-send{flex:0 0 auto;height:30px;padding:0 11px;border-radius:9px;border:1px solid transparent;background:var(--dsw-alias-button-info-fill);color:#fff;font:inherit;font-size:12px;cursor:pointer}',
      '.ssp-send:hover{background:var(--dsw-alias-button-info-hover)}',
      '.ssp-send[disabled]{opacity:.45;cursor:default}',
      '.ssp-send[data-mode="stop"]{background:var(--dsw-alias-state-error-primary)}',
      '.ssp-error{flex:0 0 auto;padding:0 10px 8px;color:var(--dsw-alias-state-error-primary);font-size:11.5px;line-height:16px;word-break:break-word}',
      '.ssp-pane-state{flex:1 1 auto;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:16px;text-align:center}',
      '.ssp-drop-hint{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:var(--dsw-alias-bg-overlay,#22262e);color:var(--dsw-alias-label-primary);box-shadow:0 8px 26px rgba(0,0,0,.35);font-size:12.5px;pointer-events:none;border:1px solid var(--dsw-alias-border-l2)}',
      '.ssp-menu-row{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;text-align:left;padding:6px 8px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;border-radius:6px}',
      '.ssp-menu-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.ssp-menu-row-icon{display:inline-flex;flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}',
      '.ssp-menu-row-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('\n')

    // ---------------------------------------------------------------------
    // Components
    // ---------------------------------------------------------------------

    /**
     * Split glyph: a square split by one vertical line.
     *
     * Used by the sidebar entry, the minimise bar and menu rows (line weight).
     */
    function SplitGlyph(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeLinecap: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('rect', { key: 'frame', x: 1.5, y: 1.5, width: 13, height: 13, rx: 3, strokeWidth: 1 }),
        h('path', { key: 'divider', d: 'M8 1.5v13', strokeWidth: 1 }),
      ])
    }

    /** Base 14px stroke icon wrapper. */
    function Icon(props) {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        'aria-hidden': 'true',
        focusable: 'false',
      }, props.children)
    }

    /** "Open in the native conversation": a panel with an outbound arrow. */
    function OpenNativeIcon() {
      return h(Icon, null, [
        h('path', { key: 'a', d: 'M6.2 3H4.3A1.3 1.3 0 0 0 3 4.3v7.4A1.3 1.3 0 0 0 4.3 13h7.4A1.3 1.3 0 0 0 13 11.7V9.8', strokeWidth: 1.4, strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M9.4 2.6h4v4', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { key: 'c', d: 'M13.4 2.6 7.6 8.4', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /** "Remove pane". */
    function CloseIcon() {
      return h(Icon, null, h('path', { d: 'M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8', strokeWidth: 1.5, strokeLinecap: 'round' }))
    }

    /** "Minimise into the floating bar". */
    function MinimizeIcon() {
      return h(Icon, null, h('path', { d: 'M3.4 8h9.2', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    /** "Clear the workbench". */
    function ClearIcon() {
      return h(Icon, null, [
        h('path', { key: 'a', d: 'M2.9 4.6h10.2', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M6.4 4.6V3.1h3.2v1.5', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { key: 'c', d: 'M4.5 4.6l.5 8.3h6l.5-8.3', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    /** "Highlight an already-open Session": a focus ring. */
    function FocusIcon() {
      return h(Icon, null, [
        h('circle', { key: 'a', cx: 8, cy: 8, r: 4.5, strokeWidth: 1.3 }),
        h('circle', { key: 'b', cx: 8, cy: 8, r: 1.3, strokeWidth: 1.3 }),
        h('path', { key: 'c', d: 'M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5', strokeWidth: 1.3, strokeLinecap: 'round' }),
      ])
    }

    /** "Compact composer": the input collapses to a single line. */
    function CompactIcon() {
      return h(Icon, null, [
        h('rect', { key: 'a', x: 2.6, y: 3.4, width: 10.8, height: 9.2, rx: 2, strokeWidth: 1.3 }),
        h('path', { key: 'b', d: 'M5.4 6.4h5.2', strokeWidth: 1.2, strokeOpacity: 0.55, strokeLinecap: 'round' }),
        h('path', { key: 'c', d: 'M5.4 9.6h5.2', strokeWidth: 1.5, strokeLinecap: 'round' }),
      ])
    }

    /** "Send" arrow, matching the shipped primary button. */
    function SendIcon() {
      return h(Icon, null, [
        h('path', { key: 'a', d: 'M8 12.6V3.6', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { key: 'b', d: 'M4.2 7.2 8 3.4l3.8 3.8', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    /**
     * Two-column split glyph for menu rows.
     *
     * Drawn on a 14-unit viewBox rendered at 14px (1:1, integer coordinates) so
     * it stays crisp next to the host's sprite icons instead of blurring.
     */
    function SplitLineIcon() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        fill: 'none',
        stroke: 'currentColor',
        strokeLinecap: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('rect', { key: 'frame', x: 1, y: 1, width: 12, height: 12, rx: 2.5, strokeWidth: 1.3 }),
        h('path', { key: 'divider', d: 'M7 1v12', strokeWidth: 1.3 }),
      ])
    }

    /** Sidebar panel entry. */
    function PanelEntry(props) {
      return h(SplitGlyph, { size: typeof props.size === 'number' ? props.size : 18 })
    }

    /**
     * Inert seat in the Conversation header.
     *
     * It remembers the current Session and, more importantly, publishes the
     * render kit: the header is a Session-scoped occurrence, so it renders
     * whenever the Conversation is on screen — which is exactly when the overlay
     * workbench needs `SessionProvider`/`renderFactorySlot`.
     */
    /** Inert seat in the Conversation header that remembers the current Session. */
    function CurrentSessionProbe(props) {
      if (typeof props.sessionId === 'string' && props.sessionId !== '') setCurrentSession(props.sessionId)
      return null
    }

    /**
     * The `main` seat: publishes the render kit and keeps every pane Session
     * retained. It renders nothing — the visible workbench is the overlay.
     */
    function KitSeat(props) {
      const statusState = props !== undefined && props !== null && typeof props.useSessionStatus === 'function'
        ? props.useSessionStatus((snapshot) => snapshot)
        : undefined
      const workspaceState = props !== undefined && props !== null && typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces((snapshot) => snapshot)
        : undefined
      useEffect(() => {
        publishKit({
          SessionProvider: props !== undefined && props !== null ? props.SessionProvider : undefined,
          renderFactorySlot: props !== undefined && props !== null ? props.renderFactorySlot : undefined,
          statusState,
          workspaceState,
        })
      }, [
        props !== undefined && props !== null ? props.SessionProvider : undefined,
        props !== undefined && props !== null ? props.renderFactorySlot : undefined,
        statusState,
        workspaceState,
      ])
      useEffect(() => {
        const ctx = ctxRef.current
        for (const sessionId of paneStore.panes) acquireSession(ctx, sessionId)
      }, [])
      return null
    }

    /** Measures the conversation column the overlay covers. */
    function measureCenterColumn() {
      if (typeof document === 'undefined') return undefined
      const slot = document.querySelector('[data-slot="main"]')
      const candidates = [document.querySelector('[data-dsh-center-col]')]
      if (slot !== null && slot !== undefined) candidates.push(slot.parentElement)
      let node = slot
      for (let depth = 0; node !== null && node !== undefined && depth < 4; depth += 1) {
        candidates.push(node)
        node = node.parentElement
      }
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined || typeof candidate.getBoundingClientRect !== 'function') continue
        const rect = candidate.getBoundingClientRect()
        if (rect.width >= 80 && rect.height >= 80) {
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
      }
      return undefined
    }

    /**
     * The persistent workbench host.
     *
     * Mounted in `shell.overlay` for the page's lifetime: switching panels only
     * hides it, so panes keep their components, scroll positions and composers.
     */
    function WorkbenchHost() {
      const ctx = ctxRef.current
      const kit = useKit()
      const [rect, setRect] = useState(null)
      const layout = ctx !== null && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      const panelInfo = useObserved(layout !== undefined && layout !== null ? layout.panelInfo : null)
      const active = panelInfo !== null && panelInfo !== undefined && panelInfo.activePanelId === PANEL_ID

      useEffect(() => {
        if (!active) {
          setRect(null)
          return undefined
        }
        const measure = () => {
          const rect = measureCenterColumn()
          setRect(rect ?? null)
          if (rect === undefined) return
          // Self-heal: a stray drag-preview transform can shove a pane's
          // composer off screen (a negative `left` on its input); clear it.
          const input = document.querySelector('[data-ssp-pane] [data-composer-input]')
          if (input !== null && input !== undefined) {
            const box = input.getBoundingClientRect()
            if (box.left < -100 || (box.width <= 0 && box.height > 0)) clearPaneOrder()
          }
        }
        measure()
        window.addEventListener('resize', measure)
        let observer = null
        const node = document.querySelector('[data-dsh-center-col]')
        if (typeof ResizeObserver === 'function' && node !== null && node !== undefined) {
          observer = new ResizeObserver(measure)
          observer.observe(node)
        }
        const timer = window.setInterval(measure, 750)
        return () => {
          window.removeEventListener('resize', measure)
          if (observer !== null) observer.disconnect()
          window.clearInterval(timer)
        }
      }, [active])

      // Opening the panel always means the workbench is expanded.
      useEffect(() => {
        if (active && paneStore.minimized) setMinimized(false)
      }, [active])

      const emptyCheck = usePanes()

      // Selecting the panel always means "show the workbench": clear any leftover
      // collapsed state instead of bouncing back to the Conversation.
      useEffect(() => {
        if (active && paneStore.minimized) setMinimized(false)
      }, [active])

      const visible = active && rect !== null && emptyCheck.minimized !== true

      // When the workbench is off screen, only the pane that duplicates the
      // on-screen Session must stop rendering — a Session with two live
      // composers loses its attachment/editor context. Other panes stay
      // mounted so switching back does not rebuild everything.
      const sessionsService = ctx !== null && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      const sessionList = useObserved(sessionsService !== undefined && sessionsService !== null ? sessionsService.list : null)
      const hiddenForActiveSession = useMemo(() => {
        if (visible) return null
        const ids = new Set()
        const byId = sessionList !== null && sessionList !== undefined && sessionList.byId !== null && typeof sessionList.byId === 'object'
          ? sessionList.byId
          : {}
        for (const [sessionId, summary] of Object.entries(byId)) {
          const retained = summary !== null && summary !== undefined ? summary.retainedBy : undefined
          if (retained !== undefined && retained !== null && (retained.mainView ?? 0) > 0) ids.add(sessionId)
        }
        return ids
      }, [visible, sessionList])
      return h('div', {
        className: 'ssp-host',
        'data-active': visible ? '' : undefined,
        style: visible
          ? { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
          : { display: 'none' },
      }, kit === null
        ? null
        : h(SplitWorkbench, {
          SessionProvider: kit.SessionProvider,
          renderFactorySlot: kit.renderFactorySlot,
          statusState: kit.statusState,
          workspaceState: kit.workspaceState,
          hiddenForActiveSession,
        }))
    }


    /** A single "N subagents" chip for one pane header, with a detail menu. */
    function SubagentChips(props) {
      const { subagents, t, onOpen } = props
      const [menu, setMenu] = useState(null)
      const buttonRef = useRef(null)

      useEffect(() => {
        if (menu === null) return undefined
        const close = (event) => {
          const node = buttonRef.current
          if (node !== null && node !== undefined && node.contains(event.target)) return
          if (event.target instanceof Element && event.target.closest('.ssp-menu') !== null) return
          setMenu(null)
        }
        window.addEventListener('mousedown', close, true)
        return () => window.removeEventListener('mousedown', close, true)
      }, [menu])

      const running = subagents.some((child) => child.running)
      const openMenu = () => {
        const node = buttonRef.current
        if (node === null || node === undefined) return
        const rect = node.getBoundingClientRect()
        setMenu({
          left: Math.min(rect.left, Math.max(8, window.innerWidth - 290)),
          top: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 320)),
        })
      }

      return h('div', { className: 'ssp-chips' }, [
        h('button', {
          key: 'count',
          ref: buttonRef,
          type: 'button',
          className: 'ssp-chip ssp-chip-count',
          title: subagents.map((child) => child.label).join('\n'),
          draggable: true,
          onClick: () => (menu === null ? openMenu() : setMenu(null)),
        }, [
          h('span', { key: 'd', className: 'ssp-chip-dot', 'data-running': running ? 'running' : undefined }),
          h('span', { key: 'l', className: 'ssp-chip-label' }, t('pane.subagentCount', { count: subagents.length })),
        ]),
        menu !== null ? h('div', { key: 'menu', className: 'ssp-menu', style: { left: `${menu.left}px`, top: `${menu.top}px` } },
          subagents.map((child) => h('button', {
            key: child.id,
            type: 'button',
            className: 'ssp-menu-item',
            onClick: () => {
              onOpen(child.id)
              setMenu(null)
            },
          }, [
            h('span', { key: 'd', className: 'ssp-chip-dot', 'data-running': child.running ? 'running' : undefined }),
            h('span', { key: 'l', className: 'ssp-menu-item-label' }, child.label),
          ]))) : null,
      ])
    }

    /** Multi-select Session picker opened from the toolbar. */
    function SessionPicker(props) {
      const { ctx, panes, t, anchor, onAdd, onClose, workspaceLookup } = props
      const [query, setQuery] = useState('')
      const [grouped, setGrouped] = useState(false)
      const [selected, setSelected] = useState(() => new Set())
      const rootRef = useRef(null)

      useEffect(() => {
        const close = (event) => {
          const node = rootRef.current
          if (node !== null && node !== undefined && node.contains(event.target)) return
          onClose()
        }
        window.addEventListener('mousedown', close, true)
        return () => window.removeEventListener('mousedown', close, true)
      }, [onClose])

      const rows = useMemo(() => {
        const state = sessionListState(ctx)
        const byId = state !== null && state !== undefined && state.byId !== null && typeof state.byId === 'object' ? state.byId : {}
        const all = Object.values(byId).filter((summary) => summary !== null && summary !== undefined
          && typeof summary.id === 'string'
          && !panes.includes(summary.id)
          && summary.archived !== true)
        all.sort((left, right) => Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0))
        const needle = query.trim().toLowerCase()
        const filtered = needle === ''
          ? all
          : all.filter((row) => String(row.title ?? row.id).toLowerCase().includes(needle))
        return filtered.slice(0, 80)
      }, [ctx, panes, query])

      const groups = useMemo(() => {
        if (!grouped) return null
        const lookup = workspaceLookup !== null && workspaceLookup !== undefined ? workspaceLookup : {}
        const map = new Map()
        for (const row of rows) {
          const sessionId = String(row.id ?? row.sessionId ?? '')
          const owner = lookup[sessionId]
          const key = owner !== undefined ? owner.key : '__none__'
          if (!map.has(key)) {
            map.set(key, {
              key,
              label: owner !== undefined ? owner.label : t('panel.unknownWorkspace'),
              rows: [],
            })
          }
          map.get(key).rows.push(row)
        }
        return Array.from(map.values()).sort((left, right) => {
          if (left.key === '__none__') return 1
          if (right.key === '__none__') return -1
          return left.label.localeCompare(right.label)
        })
      }, [grouped, rows, workspaceLookup, t])

      const toggle = (id) => setSelected((previous) => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })

      const renderRow = (row) => {
        const label = String(row.title ?? row.id)
        return h('label', { key: row.id, className: 'ssp-picker-row' }, [
          h('input', {
            key: 'check',
            type: 'checkbox',
            checked: selected.has(row.id),
            onChange: () => toggle(row.id),
          }),
          h('span', { key: 'title', className: 'ssp-picker-title', title: label }, label),
        ])
      }

      return h('div', {
        className: 'ssp-picker',
        ref: rootRef,
        style: { left: `${anchor.left}px`, top: `${anchor.top}px` },
      }, [
        h('div', { key: 'head', className: 'ssp-picker-head' }, [
          h('input', {
            key: 'search',
            className: 'ssp-picker-search',
            type: 'search',
            placeholder: t('panel.searchSessions'),
            value: query,
            onChange: (event) => setQuery(event.target.value),
          }),
          h('label', { key: 'group', className: 'ssp-picker-toggle', title: t('panel.groupByWorkspace') }, [
            h('input', {
              key: 'box',
              type: 'checkbox',
              checked: grouped,
              onChange: (event) => setGrouped(event.target.checked),
            }),
            h('span', { key: 'label' }, t('panel.groupByWorkspace')),
          ]),
        ]),
        h('div', { key: 'list', className: 'ssp-picker-list' },
          rows.length === 0
            ? h('div', { key: 'empty', className: 'ssp-picker-empty' }, t('panel.noSessions'))
            : groups !== null
              ? groups.map((group) => h('div', { key: group.key, className: 'ssp-picker-group' }, [
                h('div', { key: 'head', className: 'ssp-picker-group-head' }, group.label),
                ...group.rows.map(renderRow),
              ]))
              : rows.map(renderRow)),
        h('div', { key: 'foot', className: 'ssp-picker-foot' }, [
          h('button', { key: 'cancel', type: 'button', className: 'ssp-btn', onClick: onClose }, t('panel.cancel')),
          h('button', {
            key: 'add',
            type: 'button',
            className: 'ssp-btn ssp-btn-primary',
            disabled: selected.size === 0,
            onClick: () => onAdd(Array.from(selected)),
          }, t('panel.addSelected', { count: selected.size })),
        ]),
      ])
    }

    /** The floating bar the workbench shrinks into. */
    function MinimizeBar() {
      const ctx = ctxRef.current
      const state = usePanes()
      const [local, setLocal] = useState(null)
      const lastRef = useRef(null)
      // Set right after a drag so releasing over a button does not also click it.
      const suppressClickRef = useRef(0)
      if (state.minimized !== true || state.panes.length === 0) return null
      const t = (key) => translate(ctx, key)
      const position = local ?? state.bar
      const style = position !== null && position !== undefined
        ? { left: `${position.left}px`, top: `${position.top}px` }
        : { right: '28px', bottom: '28px' }

      const restore = () => {
        if (Date.now() - suppressClickRef.current < 250) return
        setMinimized(false)
        const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
        try {
          if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        } catch (error) {
          console.warn('[session-split] restore failed:', error)
        }
      }
      const close = () => {
        if (Date.now() - suppressClickRef.current < 250) return
        setMinimized(false)
      }

      /**
       * Drag the bar by any part of it, buttons included.
       *
       * A press on a button therefore starts a *candidate* drag: nothing moves
       * until the pointer travels 4px, and only then is the click suppressed.
       * A plain click still reaches the button.
       */
      const startDrag = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        const offsetX = event.clientX - rect.left
        const offsetY = event.clientY - rect.top
        const startX = event.clientX
        const startY = event.clientY
        let dragging = false
        const move = (moveEvent) => {
          if (!dragging) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return
            dragging = true
          }
          const left = Math.round(Math.max(8, Math.min(window.innerWidth - rect.width - 8, moveEvent.clientX - offsetX)))
          const top = Math.round(Math.max(8, Math.min(window.innerHeight - rect.height - 8, moveEvent.clientY - offsetY)))
          lastRef.current = { left, top }
          setLocal({ left, top })
        }
        const finish = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          if (dragging) suppressClickRef.current = Date.now()
          if (lastRef.current !== null) {
            setBarPosition(lastRef.current.left, lastRef.current.top)
            lastRef.current = null
          }
          setLocal(null)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      }

      return h('div', {
        className: 'ssp-bar',
        style,
        title: t('bar.hint'),
        onPointerDown: startDrag,
      }, [
        h('button', {
          key: 'restore',
          type: 'button',
          className: 'ssp-bar-main',
          title: t('bar.restore'),
          draggable: false,
          onClick: restore,
        }, [
          h(SplitGlyph, { key: 'g', size: 15 }),
          h('span', { key: 'l' }, t('bar.label')),
          h('span', { key: 'c', className: 'ssp-bar-count' }, String(state.panes.length)),
        ]),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'ssp-bar-close',
          title: t('bar.close'),
          draggable: false,
          onClick: close,
        }, '✕'),
      ])
    }

    /** One tool call row in the fallback transcript. */
    function ToolRow(props) {
      const { row, t } = props
      const [open, setOpen] = useState(false)
      const summary = summarizeArgs(row.args)
      const statusText = row.status === 'error'
        ? t('pane.toolError')
        : row.status === 'done' ? t('pane.toolDone') : t('pane.toolRunning')
      return h('div', { className: 'ssp-tool', 'data-status': row.status }, [
        h('button', {
          key: 'head',
          type: 'button',
          className: 'ssp-tool-head',
          onClick: () => setOpen((value) => !value),
        }, [
          h('span', { key: 'n', className: 'ssp-tool-name' }, row.name),
          h('span', { key: 's', className: 'ssp-tool-summary' }, summary || statusText),
          h('span', { key: 'st', className: 'ssp-tool-status' }, statusText),
        ]),
        open && row.args !== '' ? h('pre', { key: 'args', className: 'ssp-tool-body' }, row.args) : null,
        open && row.result !== '' ? h('pre', { key: 'res', className: 'ssp-tool-body' }, row.result.slice(0, 4000)) : null,
      ])
    }

    /** The fallback transcript of one pane. */
    function Transcript(props) {
      const { rows, t, hasMore } = props
      return h('div', { className: 'ssp-transcript', ref: props.scrollRef, onScroll: props.onScroll }, [
        hasMore ? h('div', { key: 'more', className: 'ssp-more' }, t('pane.more')) : null,
        ...rows.map((row) => {
          if (row.kind === 'user') return h('div', { key: row.key, className: 'ssp-row-user' }, row.text)
          if (row.kind === 'assistant') {
            return h('div', { key: row.key, className: 'ssp-row-assistant' }, [
              ...renderMarkdown(row.text, row.key),
              row.interrupted ? h('div', { key: 'i', className: 'ssp-notice' }, t('pane.interrupted')) : null,
            ])
          }
          if (row.kind === 'tool') return h(ToolRow, { key: row.key, row, t })
          return h('div', { key: row.key, className: 'ssp-notice' }, t(row.reasonKey))
        }),
        ...props.pending.map((item) => h('div', { key: `p${item.at}`, className: 'ssp-pending' }, item.text)),
      ])
    }

    /** One live Session pane: compact bar, subagent chips, shipped body. */
    function SessionPane(props) {
      const { sessionId, t, index } = props
      const ctx = ctxRef.current
      const retained = useRetainedSession(sessionId)
      const binding = retained.binding
      const sessionSnapshot = useObserved(binding ? binding.session : null)
      const eventWindow = useObserved(binding ? binding.eventSource : null)
      const [draft, setDraft] = useState('')
      const [pending, setPending] = useState([])
      const [sending, setSending] = useState(false)
      const [sendError, setSendError] = useState(null)
      const [officialComposerVisible, setOfficialComposerVisible] = useState(true)
      // 'collapsed' -> bar only; 'expanding' -> bar shrinking + composer fading in;
      // 'open' -> shipped composer only.
      const [phase, setPhase] = useState('collapsed')
      const expandTimerRef = useRef(null)
      const composerOpen = phase === 'open'
      const scrollRef = useRef(null)
      const stickRef = useRef(true)
      const paneRef = useRef(null)

      const entries = eventWindow !== null && eventWindow !== undefined && Array.isArray(eventWindow.entries) ? eventWindow.entries : []
      const rows = useMemo(() => buildTranscript(entries, MAX_ROWS), [eventWindow])
      const hasMore = eventWindow !== null && eventWindow !== undefined && eventWindow.hasMore === true
      const running = sessionSnapshot !== null && sessionSnapshot !== undefined && sessionSnapshot.running === true
      const title = sessionTitle(ctx, sessionId) ?? titleFromEvents(entries) ?? t('pane.untitled')
      const lastUserTexts = useMemo(() => new Set(rows.filter((row) => row.kind === 'user').map((row) => row.text)), [rows])
      const contentPhase = contentPhaseOf(sessionSnapshot)
      const subagents = subagentEntries(sessionListState(ctx), sessionId)

      // Make sure the list has loaded this Session's subagent projection.
      useEffect(() => {
        const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
        if (sessions !== undefined && sessions !== null && typeof sessions.refreshProjections === 'function') {
          Promise.resolve(sessions.refreshProjections(sessionId)).catch(() => {})
        }
      }, [sessionId])

      // A local echo disappears once the durable user message it mirrors lands.
      useEffect(() => {
        if (pending.length === 0) return
        setPending((list) => list.filter((item) => !lastUserTexts.has(item.text)))
      }, [lastUserTexts])

      // Follow the tail only while the reader is already at the bottom.
      useEffect(() => {
        const node = scrollRef.current
        if (node === null || node === undefined) return
        if (!stickRef.current) return
        node.scrollTop = node.scrollHeight
      }, [rows, pending])

      const onScroll = () => {
        const node = scrollRef.current
        if (node === null || node === undefined) return
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      }

      const send = () => {
        const text = draft.trim()
        if (text === '' || binding === null || sending) return
        setSending(true)
        setSendError(null)
        promptSession(binding, text).then(() => {
          setDraft('')
          setPending((list) => [...list, { text, at: Date.now() }])
        }).catch((error) => {
          setSendError(t('pane.sendFailed', { message: String((error && error.message) || error) }))
        }).finally(() => {
          setSending(false)
        })
      }

      const stop = () => {
        if (binding === null) return
        try {
          Promise.resolve(binding.session.cancel()).catch((error) => {
            setSendError(String((error && error.message) || error))
          })
        } catch (error) {
          setSendError(String((error && error.message) || error))
        }
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Enter') return
        if (event.shiftKey) return
        if (event.nativeEvent !== undefined && event.nativeEvent.isComposing === true) return
        event.preventDefault()
        send()
      }

      const remove = () => {
        setPanes(removePane(paneStore.panes, sessionId))
        releaseSession(sessionId)
      }

      /**
       * A pane header is `draggable`, so pressing an icon button inside it
       * starts a header drag as soon as the pointer moves a pixel, and the
       * browser swallows the ensuing click. Clear the header's draggable flag
       * for the duration of the press so ✕ and "open native" always fire.
       */
      const stopHeaderDrag = (event) => {
        const current = event !== null && event !== undefined ? event.currentTarget : null
        const head = current !== null && current !== undefined && typeof current.closest === 'function'
          ? current.closest('.ssp-pane-head')
          : null
        if (head === null || head === undefined) return
        head.draggable = false
        const restore = () => {
          head.draggable = true
          window.removeEventListener('pointerup', restore, true)
        }
        window.addEventListener('pointerup', restore, true)
      }

      const official = props.official
      const canRenderOfficial = official !== undefined && official !== null
        && typeof official.SessionProvider === 'function'
        && typeof official.renderFactorySlot === 'function'
        && retained.status === 'ready'
        && retained.reference !== null && retained.reference !== undefined
      // Compact mode: a placeholder bar until the user clicks into the composer.
      const collapsed = props.compact === true && phase === 'collapsed'

      // The shipped composer sits inside the body's own scroll area. If a host
      // layout ever pushes it outside the pane's box, the pane grows its own
      // composer instead, so the Session stays writable. The compact bar hides
      // the card on purpose, so it must not be judged as missing.
      useEffect(() => {
        if (!canRenderOfficial) {
          setOfficialComposerVisible(false)
          return undefined
        }
        if (collapsed) {
          setOfficialComposerVisible(true)
          return undefined
        }
        const measure = () => {
          const pane = paneRef.current
          if (pane === null || pane === undefined) return
          const card = pane.querySelector('[data-composer-card]')
          if (card === null || card === undefined) {
            setOfficialComposerVisible(false)
            return
          }
          const paneRect = pane.getBoundingClientRect()
          const cardRect = card.getBoundingClientRect()
          setOfficialComposerVisible(cardRect.height > 20
            && cardRect.top >= paneRect.top - 2
            && cardRect.bottom <= paneRect.bottom + 4)
        }
        measure()
        const timer = window.setTimeout(measure, 700)
        let observer = null
        if (typeof ResizeObserver === 'function' && paneRef.current !== null && paneRef.current !== undefined) {
          observer = new ResizeObserver(measure)
          observer.observe(paneRef.current)
        }
        return () => {
          window.clearTimeout(timer)
          if (observer !== null) observer.disconnect()
        }
      }, [canRenderOfficial, retained.status, collapsed])

      const showFallbackComposer = retained.status === 'ready' && (!canRenderOfficial || officialComposerVisible === false)
      const showFallback = showFallbackComposer && collapsed !== true

      // Opening the compact bar reveals the shipped composer and focuses it.
      // It collapses again when focus/click leaves the pane with an empty draft.
      useEffect(() => {
        if (!composerOpen) return undefined
        const pane = paneRef.current
        if (pane === null || pane === undefined) return undefined
        const input = pane.querySelector('[data-composer-input]')
        if (input !== null && input !== undefined && typeof input.focus === 'function') input.focus()
        const collapseIfEmpty = () => {
          window.setTimeout(() => {
            const node = pane.querySelector('[data-composer-input]')
            if (node === null || node === undefined || String(node.textContent ?? '').trim() === '') setPhase('collapsed')
          }, 120)
        }
        const onFocusOut = (event) => {
          if (pane.contains(event.relatedTarget)) return
          collapseIfEmpty()
        }
        const onPointerDown = (event) => {
          if (event.target instanceof Node && pane.contains(event.target)) return
          collapseIfEmpty()
        }
        pane.addEventListener('focusout', onFocusOut)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          pane.removeEventListener('focusout', onFocusOut)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [composerOpen])

      // The toggle applies to every pane at once; each pane starts collapsed.
      useEffect(() => {
        setPhase('collapsed')
      }, [props.compact === true])

      useEffect(() => () => {
        if (expandTimerRef.current !== null) window.clearTimeout(expandTimerRef.current)
      }, [])

      /** Shrink the bar away while the real composer fades in, so the layout moves continuously. */
      const expandComposer = () => {
        if (phase !== 'collapsed') return
        setPhase('expanding')
        expandTimerRef.current = window.setTimeout(() => {
          expandTimerRef.current = null
          setPhase('open')
        }, 140)
      }

      // Quoting a message inserts content into the shipped composer; reveal the
      // real composer so the user can continue typing there.
      useEffect(() => {
        if (props.compact !== true || phase !== 'collapsed') return undefined
        const pane = paneRef.current
        if (pane === null || pane === undefined) return undefined
        const input = pane.querySelector('[data-composer-input]')
        if (input === null || input === undefined) return undefined
        const observer = new MutationObserver((mutations) => {
          const grew = mutations.some((mutation) => mutation.addedNodes.length > 0)
          if (!grew) return
          observer.disconnect()
          setPhase('expanding')
          expandTimerRef.current = window.setTimeout(() => {
            expandTimerRef.current = null
            setPhase('open')
          }, 140)
        })
        observer.observe(input, { childList: true, subtree: true })
        return () => observer.disconnect()
      }, [props.compact, phase, retained.status])

      const officialBody = canRenderOfficial
        ? h('div', { key: 'official', className: 'ssp-body' },
          h(official.SessionProvider, { session: retained.reference },
            official.renderFactorySlot('conversation.content', {
              variant: 'embedded',
              phase: contentPhase.phase,
              hero: contentPhase.hero,
            })))
        : null

      const body = props.hiddenByMainView === true
        ? null
        : retained.status === 'loading'
          ? h('div', { key: 'loading', className: 'ssp-pane-state' }, t('pane.loading'))
          : retained.status === 'error'
            ? h('div', { key: 'error', className: 'ssp-pane-state' }, [
              h('div', null, t('pane.failed')),
              h('div', { style: { marginTop: 8 } }, [
                h('button', { key: 'retry', type: 'button', className: 'ssp-btn', onClick: retained.retry }, t('pane.retry')),
              ]),
            ])
            : officialBody !== null
              ? officialBody
              : h(Transcript, { key: 'body', rows, pending, hasMore, t, scrollRef, onScroll })

      return h('section', {
        className: props.flash === true ? 'ssp-pane ssp-pane-flash' : 'ssp-pane',
        'data-ssp-pane': sessionId,
        'data-index': index,
        'data-compact': props.compact === true ? '' : undefined,
        'data-collapsed': collapsed ? '' : undefined,
        'data-dragging': props.dragging === true ? '' : undefined,
        'data-drop-target': props.dropTarget === true ? '' : undefined,
        ref: paneRef,
        // Looking at a pane is enough to acknowledge its "finished, unseen" dot.
        onFocusCapture: () => acknowledgeCompletion(ctx, sessionId),
        onPointerDownCapture: () => acknowledgeCompletion(ctx, sessionId),
        style: typeof props.span === 'number' && props.span > 1 ? { gridColumn: `span ${props.span}` } : undefined,
      }, [
        h('header', {
          key: 'head',
          className: 'ssp-pane-head',
          draggable: true,
          'data-ssp-grip': '',
          title: t('pane.drag'),
        }, [
          h('span', {
            key: 'dot',
            className: 'ssp-dot',
            'data-state': retained.status === 'error' ? 'error' : running ? 'running' : props.unread === true ? 'unread' : 'idle',
            title: props.unread === true && !running ? t('pane.unread') : undefined,
          }),
          h('span', { key: 'title', className: 'ssp-pane-title', title }, title),
          subagents.length > 0
            ? h(SubagentChips, {
              key: 'chips',
              subagents,
              t,
              onOpen: (childId) => setPanes(addPane(paneStore.panes, childId)),
            })
            : null,
          h('button', {
            key: 'native',
            type: 'button',
            className: 'ssp-icon-btn',
            title: t('pane.openNative'),
            'aria-label': t('pane.openNative'),
            // Draggable so a press here can still start a title-bar drag; a
            // plain click keeps working because no drag starts without motion.
            draggable: true,
            onClick: () => openNative(ctx, sessionId),
          }, h(OpenNativeIcon)),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'ssp-icon-btn',
            title: t('pane.remove'),
            'aria-label': t('pane.remove'),
            draggable: true,
            onClick: remove,
          }, h(CloseIcon)),
        ]),
        body,
        props.compact === true && phase !== 'open' && retained.status === 'ready'
          ? h('button', {
            key: 'compactbar',
            type: 'button',
            className: phase === 'expanding' ? 'ssp-compact-bar ssp-compact-bar-shrink' : 'ssp-compact-bar',
            onClick: expandComposer,
          }, [
            h('span', { key: 'i', className: 'ssp-compact-bar-icon' }, h(SendIcon)),
            h('span', { key: 't', className: 'ssp-compact-bar-label' }, t('pane.compactPlaceholder')),
          ])
          : null,
        showFallback && sendError !== null ? h('div', { key: 'senderr', className: 'ssp-error' }, sendError) : null,
        showFallback ? h('div', { key: 'composer', className: 'ssp-composer' }, [
          h('textarea', {
            key: 'input',
            className: 'ssp-input',
            rows: 1,
            value: draft,
            placeholder: t('pane.placeholder'),
            disabled: retained.status !== 'ready',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown,
          }),
          h('button', {
            key: 'send',
            type: 'button',
            className: 'ssp-send',
            'data-mode': running && draft.trim() === '' ? 'stop' : 'send',
            disabled: retained.status !== 'ready' || (draft.trim() === '' && !running) || (draft.trim() !== '' && sending),
            onClick: () => {
              if (running && draft.trim() === '') stop()
              else send()
            },
          }, running && draft.trim() === '' ? t('pane.stop') : t('pane.send')),
        ]) : null,
      ])
    }

    /** The workbench: toolbar, column control, pane grid. */
    function SplitWorkbench(props) {
      const ctx = ctxRef.current
      const state = usePanes()
      const drag = useDragState()
      const [picker, setPicker] = useState(null)
      const t = useCallback((key, params) => translate(ctx, key, params), [ctx])
      const panes = state.panes
      const grid = planGrid(panes.length + (drag.kind === 'session' && typeof drag.previewIndex === 'number' && drag.previewIndex >= 0 ? 1 : 0), state.columns)
      // Published by the `main` seat (see KitSeat) — the overlay has no
      // selector hooks of its own.
      const workspaceState = props !== undefined && props !== null ? props.workspaceState : undefined
      const workspaceLookup = useMemo(() => workspaceIndex(workspaceState), [workspaceState])
      const statusState = props !== undefined && props !== null ? props.statusState : undefined
      const unreadIds = useMemo(() => {
        const ids = new Set()
        if (statusState === null || statusState === undefined || typeof statusState.forEach !== 'function') return ids
        statusState.forEach((status, sessionId) => {
          if (status !== null && status !== undefined && status.completionUnread === true) ids.add(sessionId)
        })
        return ids
      }, [statusState])
      const official = {
        SessionProvider: props !== undefined && props !== null ? props.SessionProvider : undefined,
        renderFactorySlot: props !== undefined && props !== null ? props.renderFactorySlot : undefined,
      }

      /** Shrink the workbench into the floating bar and hand the column back. */
      const minimize = () => {
        setMinimized(true)
        const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
        try {
          if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(null)
        } catch (error) {
          console.warn('[session-split] minimize failed:', error)
        }
      }

      // Opening the panel always means the workbench is expanded.
      useEffect(() => {
        if (paneStore.minimized) setMinimized(false)
      }, [])

      const columnsControl = h('div', { key: 'columns', className: 'ssp-columns' }, [
        h('span', { key: 'label', className: 'ssp-columns-label' }, t('panel.columns')),
        h('button', {
          key: 'auto',
          type: 'button',
          className: 'ssp-col-btn',
          'data-active': state.columns === 0 ? '' : undefined,
          onClick: () => setColumns(0),
        }, t('panel.columnsAuto')),
        ...[2, 3, 4].map((value) => h('button', {
          key: String(value),
          type: 'button',
          className: 'ssp-col-btn',
          'data-active': state.columns === value ? '' : undefined,
          // A column count is a layout ceiling, not "how many panes exist now".
          onClick: () => setColumns(value),
        }, String(value))),
      ])

      const widths = normalizeWidths(state.widths, grid.columns)
      const columnTemplate = widths.map((value) => `${value}fr`).join(' ')
      const offsets = gutterOffsets(widths)
      const gridRef = useRef(null)

      /** Paint widths straight onto the DOM so a drag never re-renders React. */
      const paintWidths = (next) => {
        const gridNode = gridRef.current
        if (gridNode === null || gridNode === undefined) return
        gridNode.style.gridTemplateColumns = next.map((width) => `${width}fr`).join(' ')
        const nextOffsets = gutterOffsets(next)
        const gutterNodes = gridNode.querySelectorAll('[data-ssp-gutter]')
        gutterNodes.forEach((node, index) => {
          if (nextOffsets[index] !== undefined) node.style.left = `${nextOffsets[index]}%`
        })
      }

      /** Start dragging one internal divider; release persists the split. */
      const startResize = (index) => (event) => {
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault()
        const container = event.currentTarget !== null && event.currentTarget !== undefined
          ? event.currentTarget.parentElement
          : null
        if (container === null || container === undefined || typeof container.getBoundingClientRect !== 'function') return
        const rect = container.getBoundingClientRect()
        const base = widths.slice()
        const startX = event.clientX
        const pair = base[index] + base[index + 1]
        const floor = Math.min(0.08, pair / 2)
        const move = (moveEvent) => {
          const delta = (moveEvent.clientX - startX) / Math.max(1, rect.width)
          const left = Math.min(Math.max(base[index] + delta, floor), pair - floor)
          const next = base.slice()
          next[index] = left
          next[index + 1] = pair - left
          paneStore.widths = normalizeWidths(next, grid.columns)
          paintWidths(paneStore.widths)
        }
        const finish = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          setWidths(paneStore.widths, true)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
      }

      /** Double-click a divider to go back to an even split. */
      const resetWidths = () => setWidths(equalWidths(grid.columns), true)

      const gutters = offsets.map((offset, index) => h('div', {
        key: `gutter-${index}`,
        className: 'ssp-gutter',
        style: { left: `${offset}%` },
        'data-ssp-gutter': String(index),
        title: t('panel.resize'),
        onPointerDown: startResize(index),
        onDoubleClick: resetWidths,
      }))

      return h('div', {
        className: 'ssp-root',
        'data-ssp-panel': '',
        'data-session-drag': drag.kind === 'session' ? '' : undefined,
      }, [
        h('div', { key: 'toolbar', className: 'ssp-toolbar' }, [
          h('span', { key: 'title', className: 'ssp-toolbar-title' }, t('panel.title')),
          h('span', { key: 'count', className: 'ssp-toolbar-count' }, `${panes.length}/${MAX_PANES}`),
          columnsControl,
          h('span', { key: 'spacer', className: 'ssp-toolbar-spacer' }),
          h('button', {
            key: 'follow',
            type: 'button',
            className: 'ssp-icon-btn ssp-icon-btn-lg',
            'data-active': state.followOpened ? '' : undefined,
            title: t('panel.followHint'),
            'aria-label': t('panel.followOpened'),
            onClick: () => setFollowOpened(!paneStore.followOpened),
          }, h(FocusIcon)),
          h('button', {
            key: 'compact',
            type: 'button',
            className: 'ssp-icon-btn ssp-icon-btn-lg',
            'data-active': state.compactComposer ? '' : undefined,
            title: t('panel.compactHint'),
            'aria-label': t('panel.compactComposer'),
            onClick: () => setCompactComposer(!paneStore.compactComposer),
          }, h(CompactIcon)),
          h('button', {
            key: 'addSession',
            type: 'button',
            className: 'ssp-btn',
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setPicker({
                left: Math.min(rect.left, Math.max(8, window.innerWidth - 346)),
                top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 470)),
              })
            },
          }, `＋ ${t('panel.addSession')}`),
          h('button', {
            key: 'minimize',
            type: 'button',
            className: 'ssp-icon-btn ssp-icon-btn-lg',
            title: t('panel.minimize'),
            'aria-label': t('panel.minimize'),
            disabled: panes.length === 0,
            onClick: minimize,
          }, h(MinimizeIcon)),
          h('button', {
            key: 'clear',
            type: 'button',
            className: 'ssp-icon-btn ssp-icon-btn-lg',
            title: t('panel.clear'),
            'aria-label': t('panel.clear'),
            disabled: panes.length === 0,
            onClick: () => {
              setPanes([])
              releaseAllSessions()
            },
          }, h(ClearIcon)),
        ]),
        panes.length === 0
          ? h('div', { key: 'empty', className: 'ssp-empty', 'data-ssp-dropzone': '' }, [
            h(SplitGlyph, { key: 'glyph', size: 34 }),
            h('div', { key: 'etitle', className: 'ssp-empty-title' }, t('panel.empty')),
            h('div', { key: 'hint', className: 'ssp-empty-hint' }, t('panel.hint')),
          ])
          : h('div', {
            key: 'grid',
            className: 'ssp-grid',
            ref: gridRef,
            'data-ssp-dropzone': '',
            'data-dropping': drag.kind === 'session' && drag.zone === 'panel' ? 'panel' : undefined,
            style: {
              gridTemplateColumns: columnTemplate,
              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            },
          }, [
            ...panes.flatMap((sessionId, index) => {
              const items = []
              if (drag.kind === 'session' && drag.previewIndex === index) {
                items.push(h('div', {
                  key: 'ssp-drop-preview',
                  className: 'ssp-pane ssp-pane-preview',
                  'data-ssp-preview': '',
                }, h('span', { className: 'ssp-pane-preview-label' }, t('panel.dropPreview'))))
              }
              items.push(h(SessionPane, {
                key: sessionId,
                sessionId,
                index,
                t,
                official,
                hiddenByMainView: props.hiddenForActiveSession !== null
                  && props.hiddenForActiveSession !== undefined
                  && props.hiddenForActiveSession.has(sessionId),
                dropTarget: undefined,
                flash: state.flash === sessionId,
                compact: state.compactComposer,
                unread: unreadIds.has(sessionId),
                dragging: drag.kind === 'pane' && drag.sessionId === sessionId,
              }))
              return items
            }),
            drag.kind === 'session' && drag.previewIndex === panes.length
              ? h('div', { key: 'ssp-drop-preview', className: 'ssp-pane ssp-pane-preview', 'data-ssp-preview': '' },
                h('span', { className: 'ssp-pane-preview-label' }, t('panel.dropPreview')))
              : null,
            ...gutters,
          ]),
        picker !== null ? h(SessionPicker, {
          key: 'picker',
          ctx,
          panes,
          t,
          anchor: picker,
          workspaceLookup,
          onClose: () => setPicker(null),
          onAdd: (ids) => {
            let list = paneStore.panes
            for (const id of ids) list = addPane(list, id)
            setPanes(list)
            setPicker(null)
          },
        }) : null,
      ])
    }

    /** Hint shown while a Session row or a pane header is being dragged. */
    function DropHint() {
      // The inline drop-preview slot already shows where the pane lands.
      return null
    }

    /** Session-row menu row: "Open in split view". */
    function SplitMenuRow(props) {
      const ctx = ctxRef.current
      const { sessionId } = props
      const [, setMenuOpen] = props.useMenuOpenState()
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'ssp-menu-row',
        onClick: () => {
          setMenuOpen(false)
          openWorkbench(ctx, sessionId)
        },
      }, [
        h('span', { key: 'icon', className: 'ssp-menu-row-icon' }, h(SplitLineIcon)),
        h('span', { key: 'label', className: 'ssp-menu-row-label' }, translate(ctx, 'menu.open')),
      ])
    }

    // ---------------------------------------------------------------------
    // Gestures
    // ---------------------------------------------------------------------

    /** The sidebar Session row id this drag started on, or null. */
    function sessionRowIdOf(target) {
      if (typeof Element === 'undefined' || !(target instanceof Element)) return null
      const row = target.closest('[data-row-key]')
      if (row === null || row === undefined) return null
      return sessionIdFromRowKey(row.getAttribute('data-row-key'))
    }

    /** The pane index this drag started on, or -1. */
    function paneIndexFromTarget(target) {
      if (typeof Element === 'undefined' || !(target instanceof Element)) return -1
      const grip = target.closest('[data-ssp-grip]')
      if (grip === null || grip === undefined) return -1
      const pane = grip.closest('[data-ssp-pane]')
      if (pane === null || pane === undefined) return -1
      const index = Number(pane.getAttribute('data-index'))
      return Number.isInteger(index) ? index : -1
    }

    /** The pane index under a drop point, or -1. */
    function paneIndexAt(target) {
      if (typeof Element === 'undefined' || !(target instanceof Element)) return -1
      const pane = target.closest('[data-ssp-pane]')
      if (pane === null || pane === undefined) return -1
      const index = Number(pane.getAttribute('data-index'))
      return Number.isInteger(index) ? index : -1
    }

    /**
     * The pane id under a viewport point, judged against the rects captured at
     * drag start.
     *
     * Hit-testing the live DOM here would fight the preview: `paintPaneOrder`
     * re-orders the panes with CSS `order`, so right after a preview swap the
     * element under the pointer belongs to the other pane. The next `dragover`
     * would then hit that one, swap back, and the two panes oscillate for as
     * long as the button stays down. Grid slots do not move during the drag, so
     * the starting rects give a stable answer.
     */
    function paneIdAtPoint(rects, x, y) {
      if (!Array.isArray(rects)) return null
      for (const entry of rects) {
        const rect = entry.rect
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
        return entry.id
      }
      return null
    }

    /** Install the gestures: Session row → pane, pane header → reorder. */
    function useWorkbenchGestures(ctx) {
      ctx.effect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
        let draggedIndex = -1
        let draggedSession = null
        // Live preview order while a pane is dragged over its neighbours.
        let previewOrder = null
        // A drop leaves the pointer over a button sometimes; swallow the click
        // that would otherwise open the native page or close the pane.
        let dragEndedAt = 0
        // Pane rects captured at drag start; hit-testing reads these instead of
        // the live DOM, which the preview re-orders.
        let draggedRects = null

        const insideWorkbench = (event) => {
          const target = event.target
          if (target === null || target === undefined || typeof target.closest !== 'function') return false
          return target.closest('[data-ssp-panel]') !== null
        }

        // File links inside a pane open on the native page: the right column
        // cannot resolve a Session while a global panel owns the main column.
        const onFileLinkClick = (event) => {
          const target = event.target
          if (typeof Element === 'undefined' || !(target instanceof Element)) return
          const link = target.closest('button[class*="fileLink"], span[class*="fileLink"], a[href^="dsh-resource://"], [class*="fileLink"], code[class*="fileLink"]')
          if (link === null) return
          const pane = link.closest('[data-ssp-pane]')
          if (pane === null) return
          const sessionId = pane.getAttribute('data-ssp-pane')
          const rawPath = String(link.textContent ?? '').trim()
          if (sessionId === null || sessionId === '' || rawPath === '') return
          event.preventDefault()
          event.stopPropagation()
          openFileOnNativePage(ctx, sessionId, rawPath)
        }

        // Clicking the sidebar icon selects the panel; clear any floating-bar
        // state in the same gesture so one click opens the workbench.
        const onPanelIconClick = (event) => {
          const target = event.target
          if (typeof Element === 'undefined' || !(target instanceof Element)) return
          if (target.closest('[data-ssp-panel], [data-ssp-bar], [data-ssp-host]') !== null) return
          const node = target.closest('button, [role="button"]')
          if (node === null) return
          const label = String(node.getAttribute('aria-label') || node.title || '').trim()
          if (label === '' || label !== translate(ctx, 'panel.title')) return
          if (paneStore.minimized) setMinimized(false)
        }

        const onDragStart = (event) => {          const transfer = event.dataTransfer
          draggedSession = sessionRowIdOf(event.target)
          if (draggedSession !== null) {
            try {
              if (transfer !== null && transfer !== undefined) transfer.setData(SESSION_DRAG_TYPE, draggedSession)
            } catch { /* a transfer that refuses custom data still drops by our own record */ }
            // Capture the pane geometry now: the preview changes the layout and
            // live hit-testing would oscillate (the slot flicker).
            const rects = Array.from(document.querySelectorAll('[data-ssp-pane]:not([data-ssp-preview])')).map((node) => {
              const rect = node.getBoundingClientRect()
              return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, index: Number(node.getAttribute('data-index')) }
            })
            setDrag({ kind: 'session', sessionId: draggedSession, overPane: null, zone: null })
            dragStore.paneRects = rects
            return
          }
          // Only a title-bar drag reorders panes; dragging selected text or a
          // message must not be mistaken for it.
          if (typeof Element === 'undefined' || !(event.target instanceof Element) || event.target.closest('[data-ssp-grip]') === null) return
          const index = paneIndexFromTarget(event.target)
          if (index >= 0) {
            draggedIndex = index
            const pane = typeof Element !== 'undefined' && event.target instanceof Element ? event.target.closest('[data-ssp-pane]') : null
            const sessionId = pane !== null ? pane.getAttribute('data-ssp-pane') : null
            try {
              if (transfer !== null && transfer !== undefined) {
                transfer.setData(PANE_DRAG_TYPE, String(sessionId ?? ''))
                const image = blankDragImage()
                if (image !== undefined) transfer.setDragImage(image, 0, 0)
              }
            } catch { /* ignore */ }
            setDrag({ kind: 'pane', sessionId: String(sessionId ?? ''), overPane: null, zone: null })
            draggedRects = Array.from(document.querySelectorAll('[data-ssp-pane]')).map((node) => ({
              id: node.getAttribute('data-ssp-pane'),
              rect: node.getBoundingClientRect(),
            }))
            const titleNode = pane !== null ? pane.querySelector('.ssp-pane-title') : null
            const label = titleNode !== null && titleNode !== undefined ? String(titleNode.textContent ?? '') : ''
            const fallback = pane !== null && pane !== undefined ? pane.getBoundingClientRect() : null
            showDragGhost(
              label,
              Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : (fallback !== null ? fallback.left + 80 : 200),
              Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : (fallback !== null ? fallback.top + 20 : 200),
            )
          }
        }

        const onDragOver = (event) => {
          if (draggedSession !== null) {
            // Session rows are only claimed inside the workbench; the shipped
            // reference-to-chat drop owns the Conversation page.
            if (!insideWorkbench(event)) {
              if (dragStore.zone !== null) setDrag({ zone: null })
              return
            }
            // Inside the workbench the split drop owns everything except the
            // composer: over an input the shipped reference drop keeps the
            // gesture, anywhere else this one does — and the reference must not
            // also fire there, so the pointer over a non-composer area is
            // claimed exclusively.
            const overComposer = event.target instanceof Element
              && event.target.closest('[data-composer-card], [data-composer-input]') !== null
            // The reference side paints its own "droppable" outline over the
            // composer. While a Session drag is anywhere but the composer, this
            // marker lets our stylesheet suppress that paint.
            const host = document.querySelector('.ssp-host')
            if (host !== null) {
              if (overComposer) host.setAttribute('data-over-composer', '')
              else host.removeAttribute('data-over-composer')
            }
            if (overComposer) {
              if (dragStore.zone !== null) setDrag({ zone: null })
              return
            }
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
            // Preview where the dragged Session would land: an empty slot is
            // rendered at that index so the layout reads before the drop.
            const rects = Array.isArray(dragStore.paneRects) ? dragStore.paneRects : []
            let insertAt = paneStore.panes.length
            for (const rect of rects) {
              if (event.clientX <= rect.right || rect === rects[rects.length - 1]) {
                insertAt = event.clientX > rect.left + (rect.right - rect.left) / 2 ? rect.index + 1 : rect.index
                break
              }
            }
            setDrag({ kind: 'session', sessionId: draggedSession, zone: 'panel', previewIndex: Math.max(0, Math.min(insertAt, paneStore.panes.length)) })
            event.preventDefault()
            try {
              if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
            } catch { /* ignore */ }
            return
          }
          if (draggedIndex >= 0) {
            // Highlight the hovered pane directly: no React state, no re-render
            // per dragover, so the cue follows the pointer in real time.
            //
            // Hit-test the drag-start rects, not the live DOM: the preview below
            // re-orders the panes with CSS `order`, so right after a swap the
            // element under the pointer belongs to the other pane and reading it
            // would swap again on the next frame (the panes oscillate).
            const overId = paneIdAtPoint(draggedRects, event.clientX, event.clientY)
            // Do not paint a marker on the hovered pane: the preview already
            // moves it, so a marker would appear on the *other* pane's slot.
            // The dragged pane's own dashed outline is the landing cue.
            setDomDropTarget(null)
            // Preview the landing spot live: the hovered pane and the dragged
            // one trade places (CSS order), so neighbours visibly move aside.
            // Hovering the dragged pane itself (or leaving every pane) restores
            // the original order, which is what makes back-and-forth work.
            const from = paneStore.panes.indexOf(dragStore.sessionId)
            const to = overId !== null ? paneStore.panes.indexOf(overId) : -1
            if (from >= 0) {
              const next = to < 0 || to === from ? paneStore.panes.slice() : movePane(paneStore.panes, from, to)
              if (previewOrder === null || previewOrder.join('|') !== next.join('|')) {
                previewOrder = next
                paintPaneOrder(next)
              }
            }
            if (dragGhost !== null) {
              dragGhost.style.left = `${event.clientX}px`
              dragGhost.style.top = `${event.clientY}px`
            }
            event.preventDefault()
            try {
              if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
            } catch { /* ignore */ }
          }
        }

        const onDrop = (event) => {
          dragEndedAt = Date.now()
          if (draggedSession !== null) {
            const sessionId = draggedSession
            draggedSession = null
            setDrag({ kind: null, sessionId: null, overPane: null, zone: null, previewIndex: null })
            dragStore.paneRects = null
            if (!insideWorkbench(event)) return
            // Over a composer the reference drop keeps the gesture; elsewhere the
            // workbench takes it (and keeps the reference from double-firing).
            const overComposer = event.target instanceof Element
              && event.target.closest('[data-composer-card], [data-composer-input]') !== null
            if (overComposer) return
            event.preventDefault()
            if (typeof event.stopPropagation === 'function') event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
            openWorkbench(ctx, sessionId)
            return
          }
          if (draggedIndex >= 0) {
            draggedIndex = -1
            draggedRects = null
            hideDragGhost()
            setDomDropTarget(null)
            setDrag({ kind: null, sessionId: null, overPane: null, zone: null })
            const landed = previewOrder
            previewOrder = null
            clearPaneOrder()
            if (landed === null) return
            event.preventDefault()
            event.stopPropagation()
            setPanes(landed)
          }
        }

        const onDragEnd = () => {
          dragEndedAt = Date.now()
          draggedIndex = -1
          draggedSession = null
          draggedRects = null
          previewOrder = null
          // A cancelled drag must leave the pre-drag layout in place.
          clearPaneOrder()
          hideDragGhost()
          setDomDropTarget(null)
          dragStore.paneRects = null
          setDrag({ kind: null, sessionId: null, overPane: null, zone: null, previewIndex: null })
        }

        // A drop often lands on the header buttons; swallow the click that
        // follows so releasing a drag does not open or close a pane.
        const onClickAfterDrag = (event) => {
          if (Date.now() - dragEndedAt < 250) {
            event.stopPropagation()
            event.preventDefault()
          }
        }

        /**
         * Safety net for a drag that ends without `dragend` — pointer released
         * outside the window, a drop swallowed by a child iframe, or an
         * OS-level cancel. Without it the ghost card and the pane highlight
         * stay on screen with no way to dismiss them.
         */
        const onGlobalEnd = () => {
          if (draggedIndex < 0 && draggedSession === null && previewOrder === null) return
          onDragEnd()
        }

        const onRowClick = (event) => {
          const sessionId = sessionRowIdOf(event.target)
          if (sessionId === null) return
          const target = event.target
          if (target instanceof Element && target.closest('button') !== null) return
          setCurrentSession(sessionId)
          const panes = paneStore.panes
          if (panes.length === 0) return
          if (paneStore.followOpened && panes.includes(sessionId)) {
            // Already on screen: keep the workbench and point at that pane.
            // The "finished, unseen" dot is cleared by the status store while a
            // Session is retained by the main view, so borrow that reference
            // briefly instead of opening the native page (which would flash).
            event.preventDefault()
            event.stopPropagation()
            flashPane(sessionId)
            acknowledgeCompletion(ctx, sessionId)
            const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
            try {
              if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
            } catch { /* the pane is already visible */ }
            return
          }
          // Switching to another Session hands the column back: keep the
          // workbench alive as the floating bar instead of dropping it, and
          // open the Session explicitly — the native row click does not
          // navigate for a Session that is already on screen, and calling
          // selectPanel(null) separately would race that navigation.
          setMinimized(true)
          const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          try {
            if (uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openSession === 'function') uiWorkspace.openSession(sessionId)
          } catch (error) {
            console.warn('[session-split] opening the Session failed:', error)
          }
        }

        window.addEventListener('dragstart', onDragStart, true)
        window.addEventListener('dragover', onDragOver, true)
        window.addEventListener('drop', onDrop, true)
        window.addEventListener('dragend', onDragEnd, true)
        window.addEventListener('click', onPanelIconClick, true)
        window.addEventListener('click', onFileLinkClick, true)
        window.addEventListener('click', onRowClick, true)
        if (typeof document.addEventListener === 'function') document.addEventListener('click', onClickAfterDrag, true)
        window.addEventListener('pointerup', onGlobalEnd, true)
        window.addEventListener('mouseup', onGlobalEnd, true)
        window.addEventListener('blur', onGlobalEnd)
        return () => {
          window.removeEventListener('dragstart', onDragStart, true)
          window.removeEventListener('dragover', onDragOver, true)
          window.removeEventListener('drop', onDrop, true)
          window.removeEventListener('dragend', onDragEnd, true)
          window.removeEventListener('click', onPanelIconClick, true)
          window.removeEventListener('click', onFileLinkClick, true)
          window.removeEventListener('click', onRowClick, true)
          if (typeof document.removeEventListener === 'function') document.removeEventListener('click', onClickAfterDrag, true)
          window.removeEventListener('pointerup', onGlobalEnd, true)
          window.removeEventListener('mouseup', onGlobalEnd, true)
          window.removeEventListener('blur', onGlobalEnd)
          draggedIndex = -1
          draggedSession = null
          dragStore.kind = null
          dragStore.sessionId = null
          dragStore.overPane = null
          dragStore.zone = null
        }
      }, 'session-split: gestures')
    }

    /** The Session id at one pane index in the current pane list. */
    function panesSessionAt(index) {
      return paneStore.panes[index] ?? null
    }

    return {
      name: 'session-split',
      inject: ['slots', 'sessions'],
      apply(ctx) {
        ctxRef.current = ctx

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = '@local/dsh-session-split'
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        }, 'session-split: styles')

        useWorkbenchGestures(ctx)

        ctx.effect(() => rememberCurrentSession(ctx), 'session-split: remember current session')

        // References live with the plugin, so they must die with it.
        ctx.effect(() => () => releaseAllSessions(), 'session-split: release sessions')

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          // Declaring this Session-scoped child is what makes the render kit
          // hand this component `SessionProvider`, the capability that
          // re-targets the shipped Conversation at one retained Session.
          children: {
            'session-split.area': { kind: 'single', scope: 'session' },
          },
        }, KitSeat))

        // The visible workbench is an overlay: switching panels never unmounts it.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-split-host',
          order: 0,
        }, WorkbenchHost))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => translate(ctx, 'panel.title'),
        }, PanelEntry))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-split-drop-hint',
        }, DropHint))

        // The minimised workbench lives in the frame overlay so it survives
        // panel switches while collapsed.
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-split-bar',
          order: 2,
        }, MinimizeBar))

        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'session-split-probe',
          order: 999,
        }, CurrentSessionProbe))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-split-row',
          order: 320,
        }, SplitMenuRow))
      },
      /** Pure helpers and components, exposed for the offline tests only. */
      __internals: {
        textBlocks,
        summarizeArgs,
        buildTranscript,
        titleFromEvents,
        subagentEntries,
        contentPhaseOf,
        planGrid,
        autoColumns,
        equalWidths,
        normalizeWidths,
        gutterOffsets,
        sessionIdFromRowKey,
        normalizePanes,
        addPane,
        removePane,
        movePane,
        renderInline,
        renderMarkdown,
        translate,
        setPanes,
        setColumns,
        setWidths,
        setMinimized,
        setBarPosition,
        setFollowOpened,
        flashPane,
        SplitWorkbench,
        SessionPane,
        SessionPicker,
        SubagentChips,
        MinimizeBar,
        PanelEntry,
        DropHint,
        SplitMenuRow,
        PANEL_ID,
        MAX_PANES,
      },
    }
  },
})



