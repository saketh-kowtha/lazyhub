import { describe, expect, it } from 'vitest'
import { buildStory, markSinceReview, MAX_STEPS, MIN_STEPS } from './build.js'
import { classifyFile, extractImports } from './classify.js'

const f = (path, additions = 5, deletions = 1, changeType = 'MODIFIED') => ({ path, additions, deletions, changeType })

describe('classifyFile', () => {
  it('puts lockfiles, generated output, snapshots and pure renames in noise', () => {
    for (const p of ['package-lock.json', 'a/yarn.lock', 'dist/app.js', 'x/app.min.js', 'src/__snapshots__/a.snap', 'logo.png', 'api/x.pb.go']) {
      expect(classifyFile(f(p)).kind, p).toBe('noise')
    }
    expect(classifyFile(f('src/a.js', 0, 0, 'RENAMED')).kind).toBe('noise')
  })

  it('never treats a renamed file with edits, or source in a dist-like name, as noise', () => {
    expect(classifyFile(f('src/a.js', 3, 1, 'RENAMED')).kind).toBe('source')
    expect(classifyFile(f('src/distance.js')).kind).toBe('source')
    expect(classifyFile(f('src/mystery.xyz')).kind).toBe('source')
  })

  it('recognises tests, config and docs', () => {
    expect(classifyFile(f('src/a.test.js')).kind).toBe('test')
    expect(classifyFile(f('pkg/a_test.go')).kind).toBe('test')
    expect(classifyFile(f('tests/helpers.js')).kind).toBe('test')
    expect(classifyFile(f('package.json')).kind).toBe('config')
    expect(classifyFile(f('.github/workflows/ci.yml')).kind).toBe('config')
    expect(classifyFile(f('README.md')).kind).toBe('config')
    expect(classifyFile(f('src/a.js')).kind).toBe('source')
  })
})

describe('extractImports', () => {
  it('reads specifiers from added lines only', () => {
    const patch = ["@@ -1 +1,3 @@", "-import old from './old.js'", "+import { a } from './lib/a.js'", "+const b = require('../b')", "+import './side'"].join('\n')
    expect(extractImports(patch)).toEqual(['./lib/a.js', '../b', './side'])
  })
})

describe('buildStory', () => {
  const pr = [
    f('src/core.js', 80, 10), f('src/caller.js', 2, 1), f('src/other.js', 3, 3),
    f('package.json'), f('README.md'), f('src/core.test.js', 40, 0), f('package-lock.json', 900, 800), f('dist/x.js', 5, 5),
  ]

  it('orders core, usage, config, tests, noise and explains each step', () => {
    const { steps } = buildStory(pr)
    expect(steps.map(s => s.kind)).toEqual(['core', 'usage', 'config', 'test', 'noise'])
    expect(steps[0].files.map(x => x.path)).toEqual(['src/core.js'])
    expect(steps[1].files.map(x => x.path)).toEqual(['src/other.js', 'src/caller.js'])
    for (const s of steps) expect(s.why).toMatch(/Grouped because/)
    expect(steps[4].collapsed).toBe(true)
  })

  it('is deterministic and keeps every file exactly once', () => {
    const a = buildStory(pr)
    const b = buildStory([...pr].reverse())
    expect(b.steps.map(s => s.files.map(x => x.path))).toEqual(a.steps.map(s => s.files.map(x => x.path)))
    expect(a.steps.flatMap(s => s.files).map(x => x.path).sort()).toEqual(pr.map(x => x.path).sort())
    expect(a.total).toBe(pr.length)
  })

  it('uses import evidence: definitions before the files that import them', () => {
    const files = [f('src/app.js', 30, 2), f('src/lib/util.js', 4, 0), f('src/lib/types.js', 5, 0)]
    const imports = { 'src/app.js': ['./lib/util.js', './lib/types'] }
    const { steps, importsUsed } = buildStory(files, { imports })
    expect(importsUsed).toBe(true)
    // Two groups only, so the core step is split in two to reach three steps; order is kept across the split.
    const core = steps.filter(s => s.kind === 'core').flatMap(s => s.files.map(x => x.path))
    expect(core).toEqual(['src/lib/types.js', 'src/lib/util.js'])
    expect(steps.find(s => s.kind === 'usage').files.map(x => x.path)).toEqual(['src/app.js'])
  })

  it('promotes the largest source file when everything looks like a small edit', () => {
    const { steps } = buildStory([f('src/a.js', 2, 0), f('src/b.js', 4, 0), f('README.md')])
    expect(steps[0].kind).toBe('core')
    expect(steps[0].files[0].path).toBe('src/b.js')
  })

  it('pads to at least 3 steps when there are enough files, never above 7', () => {
    const { steps } = buildStory([f('src/a.js', 40), f('src/b.js', 40), f('src/c.js', 40), f('src/d.js', 40)])
    expect(steps.length).toBeGreaterThanOrEqual(MIN_STEPS)
    expect(steps.length).toBeLessThanOrEqual(MAX_STEPS)
    expect(steps.flatMap(s => s.files)).toHaveLength(4)
  })

  it('splits one big group into three uniquely named steps, in order', () => {
    const files = Array.from({ length: 7 }, (_, i) => f(`src/m${i}.js`, 20, 0))
    const { steps } = buildStory(files)
    expect(steps).toHaveLength(3)
    expect(new Set(steps.map(s => s.id)).size).toBe(3)
    expect(steps.map(s => s.title)).toEqual(['Core change (1 of 3)', 'Core change (2 of 3)', 'Core change (3 of 3)'])
    expect(steps.flatMap(s => s.files.map(x => x.path))).toEqual(files.map(x => x.path))
  })

  it('handles an empty PR and a single file', () => {
    expect(buildStory([]).steps).toEqual([])
    expect(buildStory([f('src/a.js')]).steps).toHaveLength(1)
  })

  it('builds a 3,000-file PR fast without dropping a file', () => {
    const files = Array.from({ length: 3000 }, (_, i) => f(`pkg${i % 40}/dir${i % 7}/file${i}.${i % 5 === 0 ? 'test.js' : i % 11 === 0 ? 'lock' : 'js'}`, i % 50, i % 9))
    const started = performance.now()
    const story = buildStory(files)
    const marked = markSinceReview(story, new Set(files.slice(0, 100).map(x => x.path)))
    const elapsed = performance.now() - started
    expect(story.steps.flatMap(s => s.files)).toHaveLength(3000)
    expect(marked.sinceCount).toBe(100)
    expect(elapsed).toBeLessThan(500)
  })
})

describe('markSinceReview', () => {
  it('marks files and counts them per step, or reports unknown as null', () => {
    const story = buildStory([f('src/a.js', 40), f('src/b.test.js'), f('README.md')])
    const m = markSinceReview(story, new Set(['src/a.js', 'gone.js']))
    expect(m.sinceCount).toBe(1)
    expect(m.steps.find(s => s.kind === 'core').sinceCount).toBe(1)
    expect(markSinceReview(story, null).sinceCount).toBeNull()
  })
})
