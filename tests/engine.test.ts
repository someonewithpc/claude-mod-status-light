import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const SESSION = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const ENDED = { answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1' } as const

type World = { files: Record<string, string>; statuses: (string | undefined)[] }

function worldOf(on: On, settings: Record<string, unknown> = {}): World {
  const world: World = { files: {}, statuses: [] }
  mock.clock(on, { now: Date.UTC(2026, 9, 20, 12) })
  mock.env(on, { XDG_RUNTIME_DIR: '/run/user/1000' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc' }))
  on('agent.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: settings }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('tool.call', () => ({ result: 'done' }))
  on('fs.write', ($, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  return world
}

const FILE = '/run/user/1000/claude-status-light/abc.json'
const kindOf = (world: World) => JSON.parse(world.files[FILE]!).kind

describe('through the engine', () => {
  test('a turn writes working, then your turn', async ($, on) => {
    const world = worldOf(on)
    await $.session.start(SESSION)
    expect(kindOf(world)).toBe('ready')
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(kindOf(world)).toBe('working')
    await $.turn.complete({ ...ENDED, reason: 'answer' })
    expect(kindOf(world)).toBe('done')
    expect(world.statuses.at(-1)).toBe('🟢 your turn')
  })

  test('a permission query from a plugin is no dialog', async ($, on) => {
    const world = worldOf(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.check({ tool: 'Bash', input: { command: 'rm x' } })
    expect(kindOf(world)).toBe('working')
    expect(world.statuses.at(-1)).toBe('🔵 working: thinking')
  })

  test('the inline line can be turned off', { options: { inline: 'off' } }, async ($, on) => {
    const world = worldOf(on)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(world.statuses).toEqual([undefined])
    expect(kindOf(world)).toBe('working')
  })

  test('the settings env block turns the inline line off', async ($, on) => {
    const world = worldOf(on, { env: { CLAUDE_STATUS_LIGHT_INLINE: 'off' } })
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(world.statuses).toEqual([undefined])
  })
})
