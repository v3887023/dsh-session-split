/**
 * Host half of the session-split bundle.
 *
 * Everything this feature needs already exists on the Client: `ctx.sessions`
 * retains any Session and publishes its event window, `ctx.layout` selects the
 * central panel, and the slots own both the sidebar entry and the panel body.
 * There is no Host-side work to do, so this module only carries the Loader row
 * that lets the browser half mount.
 */

export const name = 'session-split'

/** No Host work: the Client half owns the workbench. */
export function apply() {}
