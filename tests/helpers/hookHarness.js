import fs from 'node:fs'
import * as verified from '../../src/utils/verifiedMutation.js'

// Runs the actual hook module with a deterministic hook scheduler. External
// I/O is injected; state, refs, effects, cleanups, and dependency changes run.
export function createHookHarness(filename, name) {
  const cells = []; let cursor = 0; let dirty = false; let effects = []; let output
  const env = { user: { id: 'A' }, rejectWrites: false, reads: [], writes: [], cache: new Map(), calls: [] }
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const React = {
    useState(initial) { const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial; return [cells[index], value => { const next = typeof value === 'function' ? value(cells[index]) : value; if (!Object.is(next, cells[index])) { cells[index] = next; dirty = true } }] },
    useRef(initial) { const index = cursor++; return cells[index] ||= { current: initial } },
    useMemo(fn, deps) { const index = cursor++; if (!cells[index] || !equal(cells[index].deps, deps)) cells[index] = { deps, value: fn() }; return cells[index].value },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const index = cursor++; const previous = cells[index]; if (!previous || !equal(previous.deps, deps)) { cells[index] = { deps, cleanup: previous?.cleanup }; effects.push(() => { cells[index].cleanup?.(); cells[index].cleanup = fn() }) } },
  }
  const dataService = {}
  for (const collection of ['Events', 'Tasks', 'Memories', 'Suggestions']) {
    dataService[`getCached${collection}`] = (...args) => env.cache.get(collection + ':' + (args.at(-1) || 'guest')) || []
    dataService[`setCached${collection}`] = (rows, id) => {
      if (env.rejectWrites) return false
      env.writes.push({ collection, id, rows: structuredClone(rows) })
      env.cache.set(collection + ':' + (id || 'guest'), structuredClone(rows))
      return true
    }
    dataService[`fetch${collection}`] = id => new Promise(resolve => { env.reads.push({ collection, id, resolve }) })
    for (const operation of ['upsert', 'delete']) dataService[operation + collection.replace(/ies$/, 'y').replace(/s$/, '')] = (...args) => { env.calls.push({ operation, collection, args }); return Promise.resolve() }
  }
  const target = new EventTarget()
  globalThis.window = target
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
  globalThis.CustomEvent ||= class extends Event { constructor(name, options) { super(name); this.detail = options.detail } }
  let latestFetch
  const coalesced = (...args) => latestFetch(...args)
  const channel = { on() { return this }, subscribe() { return this } }
  const bindings = { ...React, ...verified, dataService, useAuth: () => ({ user: env.user }),
    useCoalescedRefetch: fn => { latestFetch = fn; return coalesced },
    supabase: { channel: () => channel, removeChannel() {} },
    logSignal() {}, focusLog() {}, cleanGeneratedTitle: value => value,
    composeTimeRange: (time, duration) => time + ' +' + duration,
    parseTimeRange: time => { const parts = String(time).match(/^(\d+):(\d+)/); return parts ? { startH: Number(parts[1]) + Number(parts[2]) / 60 } : null },
    isReminderItem: () => false,
    getTaskLinks: () => ({}), getTaskParents: () => ({}), setTaskLink() {}, clearTaskLink() {}, setTaskParent() {}, clearTaskParent() {},
  }
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8')
    .replace(/^import .*? from ['"].*?['"]\s*$/gm, '').replace(/export function /g, 'function ')
  const hook = new Function(...Object.keys(bindings), source + `\nreturn ${name}`)(...Object.values(bindings))
  env.render = () => {
    let count = 0
    do { dirty = false; cursor = 0; effects = []; output = hook(); effects.forEach(effect => effect()); if (++count > 20) throw new Error('render loop') } while (dirty)
    return output
  }
  env.setUser = id => { env.user = id ? { id } : null; return env.render() }
  env.refetch = () => coalesced('test')
  env.flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); return env.render() }
  env.close = () => cells.forEach(cell => cell?.cleanup?.())
  env.render()
  return env
}
