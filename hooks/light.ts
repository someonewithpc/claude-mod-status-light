export type Kind =
  | 'ready'
  | 'working'
  | 'approval'
  | 'question'
  | 'plan'
  | 'compacting'
  | 'background'
  | 'done'
  | 'interrupted'
  | 'error'

/** What the session shows: who holds the next move, and on what. */
export type Light = {
  kind: Kind
  /** Short words for the state, the same for every instance of it. */
  label: string
  /** What it is on: the tool, the question, the tasks. Empty when there is nothing to add. */
  detail: string
  /** When this kind started, in ms since the epoch. */
  since: number
}

type Pending = { id: string; tool: string; input: unknown; agentId?: string; at: number; shownAt: number }

const BACKGROUND = /\b(\d+) (shell|agent|monitor|workflow|task|teammate)s?\b/g

/** A dialog closing shows no event of its own; a redraw this long after it opened is taken as its end. */
const SETTLE_MS = 300

export class Tracker {
  private turn: 'idle' | 'running' = 'idle'
  private ended: Exclude<Kind, 'working' | 'approval' | 'question' | 'plan' | 'compacting' | 'background' | 'ready'> | null = null
  private endedNote = ''
  private activity = 'thinking'
  private readonly asks = new Map<string, Pending>()
  private readonly dialogs = new Map<string, Pending>()
  private hintTasks = new Map<string, number>()
  private agentTasks = 0
  private wakeAt: number | null = null
  private isCompacting = false
  private current: Light

  constructor(now: number) {
    this.current = { kind: 'ready', label: 'ready', detail: '', since: now }
  }

  get light(): Light {
    return this.current
  }

  turnStart(now: number): Light {
    this.turn = 'running'
    this.ended = null
    this.activity = 'thinking'
    this.wakeAt = null
    this.asks.clear()
    this.dialogs.clear()
    return this.settle(now)
  }

  turnComplete(reason: 'answer' | 'aborted' | 'refusal' | 'error', now: number): Light {
    this.turn = 'idle'
    this.asks.clear()
    this.dialogs.clear()
    this.ended = reason === 'aborted' ? 'interrupted' : reason === 'answer' ? 'done' : 'error'
    this.endedNote = reason === 'refusal' ? 'the model refused' : reason === 'error' ? 'API error' : ''
    return this.settle(now)
  }

  /** The spinner's mode and, while a state overrides the word, its message (a retry, a wait). */
  spinner(mode: string, message: string | null, now: number): Light {
    this.clearAsksOlderThan(now - SETTLE_MS)
    if (message) this.activity = message
    else if (mode === 'thinking') this.activity = 'thinking'
    else if (mode === 'responding' || mode === 'requesting') this.activity = 'writing'
    return this.settle(now)
  }

  /** A tool's live progress row: whatever asked about it has been answered. */
  progress(now: number): Light {
    this.clearAsksOlderThan(now - SETTLE_MS)
    return this.settle(now)
  }

  toolStart(id: string, tool: string, input: unknown, agentId: string | undefined, now: number): Light {
    if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') {
      this.dialogs.set(id, { id, tool, input, agentId, at: now, shownAt: now })
    } else if (agentId === undefined) {
      this.activity = activityOf(tool, input)
    }
    if (tool === 'ScheduleWakeup') {
      const delay = Number((input as { delaySeconds?: unknown })?.delaySeconds)
      if (Number.isFinite(delay) && delay > 0) this.wakeAt = now + delay * 1000
    }
    return this.settle(now)
  }

  toolEnd(id: string, agentId: string | undefined, now: number): Light {
    this.asks.delete(id)
    this.dialogs.delete(id)
    if (agentId === undefined) this.activity = 'thinking'
    return this.settle(now)
  }

  /**
   * The permission check said `ask`. In auto mode the classifier decides most
   * of those within a second or two, so the ask shows only after `graceMs`.
   */
  ask(id: string, tool: string, input: unknown, agentId: string | undefined, graceMs: number, now: number): Light {
    if (tool !== 'AskUserQuestion' && tool !== 'ExitPlanMode') {
      this.asks.set(id, { id, tool, input, agentId, at: now, shownAt: now + graceMs })
    }
    return this.settle(now)
  }

  /** The hint line under the prompt, whose pills count the background tasks (`1 shell`). */
  hint(hint: string, now: number): Light {
    const counts = new Map<string, number>()
    for (const [, n, what] of hint.matchAll(BACKGROUND)) counts.set(what!, (counts.get(what!) ?? 0) + Number(n))
    this.hintTasks = counts
    return this.settle(now)
  }

  agents(running: number, now: number): Light {
    this.agentTasks = running
    return this.settle(now)
  }

  /** Settles again with nothing new: an ask's grace ran out, a wakeup passed. */
  tick(now: number): Light {
    return this.settle(now)
  }

  compacting(isCompacting: boolean, now: number): Light {
    this.isCompacting = isCompacting
    return this.settle(now)
  }

  private clearAsksOlderThan(cutoff: number): void {
    for (const [id, ask] of this.asks) if (ask.at <= cutoff) this.asks.delete(id)
  }

  private backgroundOf(now: number): string {
    const counts = new Map(this.hintTasks)
    counts.set('agent', Math.max(counts.get('agent') ?? 0, this.agentTasks))
    const parts = [...counts]
      .filter(([, n]) => n > 0)
      .map(([what, n]) => `${n} ${what}${n === 1 ? '' : 's'}`)
    if (this.wakeAt !== null && this.wakeAt > now) parts.push(`wakeup at ${clockOf(this.wakeAt)}`)
    return parts.join(', ')
  }

  private next(now: number): Omit<Light, 'since'> {
    const dialog = [...this.dialogs.values()].at(-1)
    if (dialog?.tool === 'ExitPlanMode') return { kind: 'plan', label: 'plan to review', detail: '' }
    if (dialog) return { kind: 'question', label: 'question for you', detail: questionOf(dialog.input) }

    const ask = [...this.asks.values()].filter((a) => a.shownAt <= now).at(-1)
    if (ask) {
      const who = ask.agentId === undefined ? '' : 'subagent: '
      return { kind: 'approval', label: 'needs approval', detail: who + activityOf(ask.tool, ask.input) }
    }

    if (this.isCompacting) return { kind: 'compacting', label: 'compacting', detail: '' }
    if (this.turn === 'running') return { kind: 'working', label: 'working', detail: this.activity }

    const background = this.backgroundOf(now)
    if (this.ended === 'error') return { kind: 'error', label: 'stopped', detail: this.endedNote }
    if (background !== '') return { kind: 'background', label: 'waiting on', detail: background }
    if (this.ended === 'interrupted') return { kind: 'interrupted', label: 'interrupted', detail: '' }
    if (this.ended === 'done') return { kind: 'done', label: 'your turn', detail: '' }
    return { kind: 'ready', label: 'ready', detail: '' }
  }

  private settle(now: number): Light {
    const next = this.next(now)
    if (next.kind !== this.current.kind) this.current = { ...next, since: now }
    else this.current = { ...next, since: this.current.since }
    return this.current
  }
}

function clockOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function oneLine(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function baseName(path: unknown): string {
  return typeof path === 'string' ? path.split('/').filter(Boolean).at(-1) ?? path : ''
}

function questionOf(input: unknown): string {
  const first = (input as { questions?: { header?: unknown; question?: unknown }[] })?.questions?.[0]
  const text = typeof first?.question === 'string' ? first.question : typeof first?.header === 'string' ? first.header : ''
  return oneLine(text)
}

/** A few words for what a tool call does, as a glance at the status line wants them. */
export function activityOf(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const str = (key: string) => (typeof i[key] === 'string' ? (i[key] as string) : '')
  switch (tool) {
    case 'Bash':
      return `Bash: ${oneLine(str('description') || str('command'))}`
    case 'Read':
      return `reading ${baseName(i.file_path)}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `editing ${baseName(i.file_path ?? i.notebook_path)}`
    case 'Write':
      return `writing ${baseName(i.file_path)}`
    case 'Grep':
    case 'Glob':
      return `searching ${oneLine(str('pattern'), 40)}`
    case 'WebFetch':
      return `fetching ${oneLine(str('url'), 50)}`
    case 'WebSearch':
      return `searching the web: ${oneLine(str('query'), 40)}`
    case 'Agent':
    case 'Task':
      return `agent: ${oneLine(str('description'))}`
    case 'Skill':
      return `skill: ${str('skill')}`
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return `${mcp[1]}: ${mcp[2]}`
  return tool
}
