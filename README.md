# dsh-session-split

A split workbench for DSH: up to six Sessions side by side in the main area,
each one running the **shipped Conversation** — the real Chat flow, the real
composer, real tool cards, real approval and question prompts.

## How the shipped UI is reused

DSH mounts exactly one Conversation inside `main.conversation`, but the slot
renderer exposes two pieces that make more occurrences possible:

1. **`renderFactorySlot('conversation.content', …)`** renders any registered
   Component Factory by name, from any Slot component. The Conversation body —
   Chat flow, composer, approvals, Turn controls — is exactly that Factory.
2. **`SessionProvider`** re-targets the Factory occurrence at one
   `SessionReference`; `ctx.sessions.retain(id)` produces that reference for any
   Session. Both arrive in the render kit a Slot component receives once its
   registration declares a Session-scoped child.

A pane is therefore: retain the Session → wrap the Factory in `SessionProvider`
→ render. Nothing about the conversation UI is re-implemented.

The Factory is called with the same inputs the host's own embedded occurrence
(right Sidebar chat tab) uses — `variant: 'embedded'` plus `phase`/`hero`
derived from the Session snapshot — so the body keeps its own layout rules,
including the composer pinned to the scrollport floor. No CSS override is
needed.

The `phase` rule matters: **hero only for a Session the snapshot reports as
blank (and not running)**; a Session with history is always `active`, and an
opening Session is `settling`. Guessing hero for a Session that merely has not
projected `promptAttempted` yet renders the blank home, which has no ordinary
composer — that was the "no input box until I send something" bug.

Deliberately **not** reused is the Conversation header (title row, subagent
tree, View tabs): it belongs to the `main.conversation` slot, which is a single
slot — declaring it from a plugin collapses the host's declaration and takes the
whole conversation page down (verified). A pane adds a compact one-line bar of
its own instead, and the body fills the rest of the cell.

If a host ever withholds that kit, each pane falls back to a compact reading
view built from the retained event window.

## Layout

- 1 to 6 panes in an automatic grid: 2 side by side, 3 as columns, 4 as 2×2,
  5–6 as 3×2.
- A manual column override in the toolbar (`Auto` / `2` / `3` / `4`) pins the
  column count; rows follow from the pane count.
- **Drag a divider to resize columns** (like an IDE): each pair of neighbouring
  columns splits the pointer delta, 8% minimum per column, and the ratios are
  persisted. The drag paints `grid-template-columns` straight onto the DOM and
  only commits on release, so the split tracks the pointer without re-rendering
  the panes. **Double-click a divider** to return to an even split.
- **Drag a pane by its title bar to reorder it**: a press anywhere on the title
  bar works — including on its buttons, which are themselves draggable so the
  press is not swallowed — and a click without motion still hits the button. A
  drop leaves the pointer over a button sometimes, so the trailing click is
  swallowed for 250 ms. Drop it on another pane to
  take that slot, and the order is persisted. While dragging, the pane you
  picked fades out, a small title card follows the pointer (the browser's own
  drag ghost is suppressed), and the neighbours **swap places live**: a CSS
  `order` preview animated with FLIP (each moved pane slides from its old box to
  the new one), so moving back and forth across panes previews each landing spot
  in turn. The preview is discarded on cancel and committed on drop.
- Every pane has its own composer, streaming output, Stop, queue, approvals and
  question cards — they are the host's own components.
- The pane header carries the Session title (13.5 px), a running dot, a single
  **`N subagents`** chip (hover lists them, click opens the list to open one in
  a pane), and two stroke icons: open natively and remove pane.
- **Add sessions from the toolbar**: `＋ Add session` lists every Session that
  is not already a pane; the list has search plus a **Group by workspace**
  switch on the right of the search box, and adds the whole selection at once.
- **`Highlight opened` switch** (on by default): clicking a Session that is
  already a pane keeps the workbench and flashes that pane instead of opening
  the native page. With the switch off, that click opens the native page.
- **Focus acknowledges**: clicking into a pane (or focusing it) clears that
  Session's "finished, unseen" dot — the workbench borrows the same `mainView`
  reference the native open uses, so the status store drops the marker without
  navigating away.
- **The workbench is persistent.** It is mounted in `shell.overlay` for the
  page's lifetime and the `main` seat only publishes the render kit, so
  switching panels (or minimising) hides it instead of unmounting it — panes
  keep their components, scroll positions, drafts and composers.
- **Leaving the workbench collapses it**: clicking any other Session opens it
  natively and shrinks the persistent workbench into the floating bar, so the
  split layout is never dropped. Selecting the workbench panel again expands it
  and dismisses the bar automatically.
- **The floating bar is draggable from anywhere on it**, buttons included: a
  press becomes a drag only after 4 px of movement, so a plain click still
  restores or closes it.
- **Compact composer switch**: replaces each composer with a one-line
  placeholder bar (`↑ Message…`). The bar is absolutely positioned over the
  pane's bottom edge, so collapsing/expanding changes the layout once instead of
  re-flowing the message list every frame. Clicking it reveals the host's own
  composer untouched — references, attachments, model picker and send all intact
  — with a `clip-path` wipe from the composer's bottom edge (no re-flow), and
  focuses it; it folds back when focus leaves the pane with an empty draft,
  while a non-empty draft keeps it open. Quoting a message (which inserts content
  into the composer) opens the real composer automatically. The collapsed bar
  also hides the composer's usage/activity dock (rounds, steps, context).
  Exactly one composer is visible per pane — the fallback composer is suppressed
  while the bar is collapsed, so the two can never stack.
- **File links route through the native page.** The right column resolves a
  file from the *on-screen* Session, and a global panel is not one — so a click
  on a file link inside a pane reveals the native Conversation (which makes the
  Session on-screen) and then opens that file in the right column. The path is
  read from the link text and addressed as
  `dsh-resource://file/session/<id>/<path>`.
- **Composer fallback**: the shipped composer lives inside the body's scroll
  area, and a host layout change can push it outside the pane's box. The pane
  measures it and, when it is not inside the pane, renders its own compact
  composer instead (never both), so a Session stays writable.

## Surfaces

| Where | What it does |
| --- | --- |
| Sidebar panel icon (order 30) | Opens the workbench as a main panel |
| Toolbar `＋ Add session` | Multi-select picker over every Session not already shown, with workspace grouping |
| Toolbar `Highlight opened` | Toggles what clicking an already-shown Session does |
| Toolbar compact icon | Replaces each composer with a click-to-expand placeholder bar |
| Toolbar minus icon | Collapses the workbench into a draggable floating bar |
| Toolbar bin icon | Removes every pane |
| Session row menu → **在分屏中打开** | Adds that Session as a pane and opens the workbench; works from anywhere, no gesture conflicts |
| Drag a Session row **inside** the workbench | Adds it as a pane |
| Pane title bar drag | Reorders panes |
| Pane **↗** | Opens that Session in the shipped Conversation page |
| Subagent chip | One `N subagents` chip; click to pick one and open it in a pane |

The Session drag is deliberately limited to the workbench itself: dragging a
Session row onto the Conversation page already means "reference this chat here"
(`dsh-session-reference`), and two handlers on one drop would both fire.

## Known limits

- **Each Session appears once** — one editable conversation root per Session is
  the rule the Conversation package itself documents.
- **Six panes maximum**; a full workbench drops the oldest pane to make room.
- **The Conversation header is not part of a pane** (see above), so View tabs
  and the subagent tree stay on the native page (↗).
- Selecting the workbench unmounts the normal Conversation column, which is what
  keeps drafts and scroll positions from colliding between the two.
- **Session references are owned by the plugin, not by a pane.** Leaving the
  panel (minimise, or opening another Session) unmounts the panes but keeps
  their retained Session alive, so returning is instant instead of reloading
  history. References are released when a pane is removed, the workbench is
  cleared, or the plugin unloads.

## Layout of the package

```text
packages/dsh-session-split
  client.js        browser half: workbench, panes, grid, gestures
  index.js         Host half: no-op, the Loader row that mounts the browser half
  cordis.patch.yml one inserted row
  locale/*.json    plugin-list title and description
  icon.svg         sidebar artwork
  test/            offline behaviour, wiring, and render smoke tests
```

## Test

```powershell
node test/transcript.test.mjs
node test/registration.test.mjs
node test/render.test.mjs
```

## Install

Install straight from GitHub into your DSH profile:

``bash
# latest from main
dsh plugin --profile <profile> add git+https://github.com/v3887023/dsh-session-split.git

# pinned to a release tag
dsh plugin --profile <profile> add git+https://github.com/v3887023/dsh-session-split.git#v1.2.3
``

Then open **会话分屏** in the sidebar. To update, run the same command again with a
newer tag; to uninstall:

``bash
dsh plugin --profile <profile> remove @v3887023/dsh-session-split
``
