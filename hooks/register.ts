import type { EngineInterface, Register } from 'claude-code'

import { Tracker, type Kind, type Light } from './light'

const DOT: Record<Kind, string> = {
  ready: '⚪',
  working: '🔵',
  approval: '🔴',
  question: '🟣',
  plan: '🟣',
  compacting: '🔵',
  background: '🟡',
  done: '🟢',
  interrupted: '⚪',
  error: '🔴',
}

/** Auto mode's classifier answers most asks within this; past it the person is likely being asked. */
const AUTO_GRACE_MS = 4000

let tracker = new Tracker(Date.now())
let lightPath = ''
let isInline = true
let isAuto = false
let written = ''

async function show($: EngineInterface, light: Light): Promise<void> {
  const text = JSON.stringify(light)
  if (text === written) return
  written = text
  if (isInline) $.ui.status(`${DOT[light.kind]} ${light.label}${light.detail ? `: ${light.detail}` : ''}`)
  if (lightPath !== '') await $.fs.write(lightPath, `${text}\n`).catch(() => {})
}

async function countAgents($: EngineInterface): Promise<number> {
  const agents = await $.agent.list().catch(() => [])
  return agents.filter((a) => a.status === 'pending' || a.status === 'running').length
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const answer = await next(e)
    tracker = new Tracker(await $.clock.now())
    written = ''
    const env = await $.env.get('CLAUDE_STATUS_LIGHT_INLINE')
    isInline = env ? env !== 'off' : options.inline !== 'off'
    const runtimeDir = (await $.env.get('XDG_RUNTIME_DIR')) || '/tmp'
    lightPath = `${runtimeDir}/claude-status-light/${await $.session.id()}.json`
    await show($, tracker.light)

    $.clock.every(2000, async () => {
      const running = await countAgents($)
      await show($, tracker.agents(running, await $.clock.now()))
    })
    return answer
  })

  on('session.end', async ($, e, next) => {
    if (lightPath !== '') await $.fs.write(lightPath, '').catch(() => {})
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await show($, tracker.turnStart(await $.clock.now()))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await show($, tracker.turnComplete(e.reason, await $.clock.now()))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? ''
    await show($, tracker.toolStart(id, String(e.tool), e, e.agentId, await $.clock.now()))
    try {
      return await next(e)
    } finally {
      await show($, tracker.toolEnd(id, e.agentId, await $.clock.now()))
    }
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id !== undefined) {
      const grace = isAuto ? AUTO_GRACE_MS : 0
      await show($, tracker.ask(e.tool_use_id, e.tool, e.input, e.agentId, grace, await $.clock.now()))
      if (grace > 0) $.clock.after(grace + 50, async () => show($, tracker.tick(await $.clock.now())))
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    await show($, tracker.compacting(true, await $.clock.now()))
    try {
      return await next(e)
    } finally {
      await show($, tracker.compacting(false, await $.clock.now()))
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    await show($, tracker.spinner(e.props.mode, e.props.message, await $.clock.now()))
    return next(e)
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    await show($, tracker.progress(await $.clock.now()))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await show($, tracker.hint(e.props.hint, await $.clock.now()))
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    isAuto = e.props.modes.some((mode) => /\bauto\b/i.test(mode))
    return next(e)
  })
}
