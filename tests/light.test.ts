import { describe, expect, test } from 'claude-code/testing'

import { Tracker, activityOf } from '../hooks/light'

const T0 = Date.UTC(2026, 9, 20, 12, 0)

describe('the light', () => {
  test('a turn is working, then your turn', () => {
    const t = new Tracker(T0)
    expect(t.light.kind).toBe('ready')
    expect(t.turnStart(T0 + 1).kind).toBe('working')
    expect(t.toolStart('a', 'Bash', { command: 'npm test', description: 'Run the tests' }, undefined, T0 + 2))
      .toMatchObject({ kind: 'working', detail: 'Bash: Run the tests', since: T0 + 1 })
    expect(t.toolEnd('a', undefined, T0 + 3).detail).toBe('thinking')
    expect(t.turnComplete('answer', T0 + 4)).toMatchObject({ kind: 'done', label: 'your turn', since: T0 + 4 })
  })

  test('an ask shows until the tool runs', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    t.toolStart('a', 'Bash', { command: 'rm x' }, undefined, T0 + 10)
    expect(t.ask('a', 'Bash', { command: 'rm x' }, undefined, 0, T0 + 20))
      .toMatchObject({ kind: 'approval', detail: 'Bash: rm x' })
    expect(t.spinner('tool-use', null, T0 + 100).kind).toBe('approval')
    expect(t.spinner('tool-use', null, T0 + 5000).kind).toBe('working')
  })

  test('an ask ends with its call', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    t.ask('a', 'Write', { file_path: '/r/notes.md' }, undefined, 0, T0)
    expect(t.light.detail).toBe('writing notes.md')
    expect(t.toolEnd('a', undefined, T0 + 50).kind).toBe('working')
  })

  test('in auto mode an ask shows only past its grace', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    expect(t.ask('a', 'Bash', { command: 'ls' }, undefined, 4000, T0).kind).toBe('working')
    expect(t.tick(T0 + 4100).kind).toBe('approval')
  })

  test('a subagent asking shows while the main loop is idle', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    t.turnComplete('answer', T0 + 1)
    expect(t.ask('b', 'Bash', { description: 'Build' }, 'agent-1', 0, T0 + 2))
      .toMatchObject({ kind: 'approval', detail: 'subagent: Bash: Build' })
  })

  test('questions and plans wait on the person until answered', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    const q = { questions: [{ header: 'Library', question: 'Which library should we use?' }] }
    expect(t.toolStart('q', 'AskUserQuestion', q, undefined, T0 + 1))
      .toMatchObject({ kind: 'question', detail: 'Which library should we use?' })
    expect(t.spinner('tool-use', null, T0 + 9000).kind).toBe('question')
    expect(t.toolEnd('q', undefined, T0 + 9001).kind).toBe('working')
    expect(t.toolStart('p', 'ExitPlanMode', {}, undefined, T0 + 9002).kind).toBe('plan')
  })

  test('background tasks hold the light yellow after the turn', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    t.hint('2 shells · 1 agent · ← for agents', T0 + 1)
    expect(t.turnComplete('answer', T0 + 2)).toMatchObject({ kind: 'background', detail: '2 shells, 1 agent' })
    expect(t.hint('← for agents', T0 + 3).kind).toBe('done')
  })

  test('the agent list and the hint are not counted twice', () => {
    const t = new Tracker(T0)
    t.hint('1 agent', T0)
    t.agents(1, T0)
    expect(t.light.detail).toBe('1 agent')
    expect(t.agents(3, T0).detail).toBe('3 agents')
  })

  test('a scheduled wakeup is something to wait on', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    t.toolStart('w', 'ScheduleWakeup', { delaySeconds: 600 }, undefined, T0)
    t.toolEnd('w', undefined, T0)
    expect(t.turnComplete('answer', T0 + 1)).toMatchObject({ kind: 'background' })
    expect(t.light.detail).toMatch(/^wakeup at \d\d:\d\d$/)
    expect(t.tick(T0 + 601_000).kind).toBe('done')
  })

  test('errors, refusals and interrupts end the turn their own way', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    expect(t.turnComplete('error', T0)).toMatchObject({ kind: 'error', detail: 'API error' })
    t.turnStart(T0)
    expect(t.turnComplete('refusal', T0)).toMatchObject({ kind: 'error', detail: 'the model refused' })
    t.turnStart(T0)
    expect(t.turnComplete('aborted', T0).kind).toBe('interrupted')
  })

  test('compaction shows over a finished turn', () => {
    const t = new Tracker(T0)
    t.turnComplete('answer', T0)
    expect(t.compacting(true, T0).kind).toBe('compacting')
    expect(t.compacting(false, T0).kind).toBe('done')
  })

  test('a spinner message (a retry) replaces the activity', () => {
    const t = new Tracker(T0)
    t.turnStart(T0)
    expect(t.spinner('requesting', 'Retrying in 5s', T0).detail).toBe('Retrying in 5s')
  })
})

describe('activityOf', () => {
  test('names tools briefly', () => {
    expect(activityOf('Read', { file_path: '/a/b/c.ts' })).toBe('reading c.ts')
    expect(activityOf('Agent', { description: 'Find the config' })).toBe('agent: Find the config')
    expect(activityOf('mcp__github__create_pr', {})).toBe('github: create_pr')
    expect(activityOf('Bash', { command: 'x'.repeat(100) })).toHaveLength(66)
  })
})
