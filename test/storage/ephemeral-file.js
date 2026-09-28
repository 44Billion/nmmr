import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

function worker (root) {
  const child = fork(new URL('../../fixtures/storage-worker.mjs', import.meta.url), { env: { ...process.env, TMPDIR: root }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let serial = 0
  return {
    async call (action) {
      const id = ++serial
      const reply = once(child, 'message')
      child.send({ id, action })
      const [message] = await reply
      if (message.error) throw new Error(message.error)
      return message.result
    },
    async stop () { const exited = once(child, 'exit'); child.kill(); await exited }
  }
}

describe('temporary leaf ownership', function () {
  this.timeout(10000)
  let root
  const children = []
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'nmmr-ownership-test-')) })
  afterEach(async () => { await Promise.all(children.splice(0).map(child => child.stop())); await rm(root, { recursive: true, force: true }) })

  it('a second process never deletes the first process live leaves or legacy files', async () => {
    await mkdir(join(root, 'ephemeral-files'))
    const legacy = join(root, 'ephemeral-files', 'owned-by-another-process')
    await writeFile(legacy, 'retain')
    const a = worker(root); const b = worker(root); children.push(a, b)
    await a.call('write')
    await b.call('write')
    assert.deepEqual(await a.call('read'), [[1, 2, 3]])
    assert.deepEqual(await b.call('read'), [[1, 2, 3]])
    assert.equal(await readFile(legacy, 'utf8'), 'retain')
    await a.call('close')
    await assert.rejects(a.call('read'), /NMMR_CLOSED/)
    assert.deepEqual(await b.call('read'), [[1, 2, 3]])
  })

  it('write failures are propagated instead of silently accepting missing leaves', async () => {
    const a = worker(root); children.push(a)
    await assert.rejects(a.call('writeFailure'), /ENOSPC/)
  })

  it('concurrent initial writes with identical labels stay isolated and close only owned directories', async () => {
    const a = worker(root); children.push(a)
    assert.deepEqual(await a.call('concurrent'), Array.from({ length: 8 }, (_, index) => [String(index)]))
    assert.equal((await readdir(root)).length, 8)
    await a.call('close')
    await a.call('close')
    assert.deepEqual(await readdir(root), [])
  })
})

describe('browser temporary leaf ownership', () => {
  const saved = {}
  let serial = 0
  beforeEach(() => {
    for (const key of ['window', 'indexedDB', 'IDBKeyRange']) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    globalThis.window = {}
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
  })
  afterEach(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key])
      else delete globalThis[key]
    }
  })
  const load = async () => (await import(`../../src/lib/ephemeral-file.js?browser=${++serial}`)).default

  it('independent module instances preserve each other records, including identical labels', async () => {
    const First = await load()
    const a = new First('shared-label')
    await a.writeLine('alpha')
    const Second = await load()
    const b = new Second('shared-label')
    await b.writeLine('beta')
    assert.deepEqual(await Array.fromAsync(a.readLines()), ['alpha'])
    assert.deepEqual(await Array.fromAsync(b.readLines()), ['beta'])
    await b.close()
    assert.deepEqual(await Array.fromAsync(a.readLines()), ['alpha'])
    await a.close()
  })

  it('slow readers never cross into interleaved files and close awaits accepted writes', async () => {
    const File = await load()
    const a = new File(); const b = new File()
    for (let index = 0; index < 300; index++) {
      await a.writeLine(`a${index}`)
      await b.writeLine(`b${index}`)
    }
    const lines = []
    for await (const line of a.readLines()) {
      lines.push(line)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    assert.deepEqual(lines, Array.from({ length: 300 }, (_, index) => `a${index}`))
    const writing = a.writeLine('last')
    await a.close()
    await writing
    await assert.rejects(a.writeLine('closed'), /CLOSED/)
    assert.equal((await Array.fromAsync(b.readLines())).length, 300)
    await b.close()
  })
})
