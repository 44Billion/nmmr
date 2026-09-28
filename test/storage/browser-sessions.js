import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'

// A lock remains owned until its callback settles or its document terminates.
function lockManager () {
  const held = new Map()
  return {
    held,
    async request (name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {} }
      if (held.has(name)) {
        assert.equal(options.ifAvailable, true, 'collectors must never wait on live owners')
        return callback(null)
      }
      const terminated = Promise.withResolvers()
      const owner = { end: () => terminated.reject(new Error('DOCUMENT_TERMINATED')) }
      held.set(name, owner)
      try { return await Promise.race([callback({ name }), terminated.promise]) } finally {
        if (held.get(name) === owner) held.delete(name)
      }
    }
  }
}

const done = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve
  tx.onabort = () => reject(tx.error || new Error('ABORTED'))
  tx.onerror = () => reject(tx.error)
})
const open = (version = 2) => new Promise((resolve, reject) => {
  const request = indexedDB.open('ephemeral-files', version)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => resolve(request.result)
  request.onupgradeneeded = () => {
    const store = request.result.createObjectStore('lines', { autoIncrement: true })
    store.createIndex('filename', 'filename')
    if (version === 2) request.result.createObjectStore('nmmr-sessions')
  }
})
async function snapshot () {
  const db = await open()
  try {
    const tx = db.transaction(['lines', 'nmmr-sessions'])
    const completion = done(tx)
    const rows = tx.objectStore('lines').getAll()
    const sessions = tx.objectStore('nmmr-sessions').getAllKeys()
    await completion
    return { rows: rows.result, sessions: sessions.result }
  } finally { db.close() }
}

let serial = 0
const load = async () => (await import(`../../src/lib/ephemeral-file.js?sessions=${++serial}`)).default

describe('browser abandoned session collection', () => {
  const saved = {}
  let locks
  beforeEach(() => {
    for (const key of ['window', 'indexedDB', 'IDBKeyRange', 'navigator']) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    locks = lockManager()
    for (const [key, value] of Object.entries({ window: {}, indexedDB: new IDBFactory(), IDBKeyRange, navigator: { locks } })) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    }
  })
  afterEach(async () => {
    for (const owner of locks.held.values()) owner.end()
    await new Promise(resolve => setImmediate(resolve))
    for (const key of Object.keys(saved)) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key])
      else delete globalThis[key]
    }
  })

  it('collects a terminated owner while preserving a live owner and per-file close', async () => {
    const A = await load(); const a = new A(); const other = new A()
    await a.writeLine('live'); await other.writeLine('same session')
    const B = await load(); const b = new B()
    await b.writeLine('abandoned')
    const ownerB = (await snapshot()).rows.find(row => row.__str__ === 'abandoned').filename.split(':')[1]
    locks.held.get(`nmmr:ephemeral-files:session:${ownerB}`).end()
    await new Promise(resolve => setImmediate(resolve))
    const C = await load(); const c = new C()
    await c.writeLine('new')
    assert.deepEqual((await snapshot()).rows.map(row => row.__str__), ['live', 'same session', 'new'])
    assert.equal((await snapshot()).sessions.includes(ownerB), false)
    await assert.rejects(b.writeLine('after termination'), /SESSION_ENDED/)
    await a.close()
    assert.deepEqual(await Array.fromAsync(other.readLines()), ['same session'])
    assert.deepEqual(await Array.fromAsync(c.readLines()), ['new'])
    await other.close(); await c.close()
  })

  it('concurrent initializations collect abandoned rows without deleting each other', async () => {
    const Old = await load(); const old = new Old()
    await old.writeLine('old')
    for (const owner of locks.held.values()) owner.end()
    await new Promise(resolve => setImmediate(resolve))
    const classes = await Promise.all(Array.from({ length: 8 }, () => load()))
    const files = classes.map(File => new File('identical-label'))
    await Promise.all(files.map((file, index) => file.writeLine(`new-${index}`)))
    assert.equal((await snapshot()).sessions.length, 8)
    assert.deepEqual((await snapshot()).rows.map(row => row.__str__).sort(), Array.from({ length: 8 }, (_, index) => `new-${index}`))
    for (const [index, file] of files.entries()) assert.deepEqual(await Array.fromAsync(file.readLines()), [`new-${index}`])
    await Promise.all(files.map(file => file.close()))
  })

  it('does not register ownership or write rows before acquiring its lifetime lock', async () => {
    const grant = Promise.withResolvers()
    const requested = Promise.withResolvers()
    const request = locks.request.bind(locks)
    let first = true
    locks.request = async (...args) => {
      if (first) { first = false; requested.resolve(); await grant.promise }
      return request(...args)
    }
    const A = await load(); const a = new A()
    const writing = a.writeLine('waiting')
    await requested.promise
    assert.deepEqual(await snapshot(), { rows: [], sessions: [] })
    const B = await load(); const b = new B()
    await b.writeLine('other')
    grant.resolve(); await writing
    assert.deepEqual(await Array.fromAsync(a.readLines()), ['waiting'])
    assert.deepEqual(await Array.fromAsync(b.readLines()), ['other'])
    await a.close(); await b.close()
  })

  it('preserves version-one and lockless rows during migration and later collection', async () => {
    const legacy = await open(1)
    const tx = legacy.transaction('lines', 'readwrite'); const completion = done(tx)
    tx.objectStore('lines').add({ filename: 'legacy-file', __str__: 'legacy' })
    await completion; legacy.close()
    globalThis.navigator = {}
    const Fallback = await load(); const fallback = new Fallback()
    await fallback.writeLine('without locks')
    globalThis.navigator = { locks }
    const Managed = await load(); const managed = new Managed()
    await managed.writeLine('managed')
    assert.deepEqual((await snapshot()).rows.map(row => row.__str__), ['legacy', 'without locks', 'managed'])
    assert.equal((await snapshot()).sessions.length, 1)
    await managed.close()
    assert.deepEqual(await Array.fromAsync(fallback.readLines()), ['without locks'])
    await fallback.close()
    assert.deepEqual((await snapshot()).rows.map(row => row.__str__), ['legacy'])
  })

  it('aborted collection retains both rows and ownership for a later retry', async () => {
    const Old = await load(); const old = new Old()
    await old.writeLine('abandoned')
    for (const owner of locks.held.values()) owner.end()
    await new Promise(resolve => setImmediate(resolve))
    const before = await snapshot()
    const db = await open()
    const prototype = Object.getPrototypeOf(db)
    const transaction = prototype.transaction
    prototype.transaction = function (stores, ...args) {
      const tx = transaction.call(this, stores, ...args)
      if (Array.isArray(stores) && stores.includes('lines') && args[0] === 'readwrite') queueMicrotask(() => tx.abort())
      return tx
    }
    const File = await load(); const failed = new File()
    try { await assert.rejects(failed.writeLine('must not commit'), /ABORTED/) } finally {
      prototype.transaction = transaction
      db.close()
    }
    assert.deepEqual((await snapshot()).rows, before.rows)
    assert.ok((await snapshot()).sessions.includes(before.sessions[0]))
    const retry = new File()
    await retry.writeLine('retried')
    assert.deepEqual((await snapshot()).rows.map(row => row.__str__), ['retried'])
    await failed.close(); await retry.close()
  })

  it('reports a blocked legacy upgrade and lets a new instance retry after it closes', async () => {
    const legacy = await open(1)
    const File = await load(); const blocked = new File()
    await assert.rejects(blocked.writeLine('blocked'), /UPGRADE_BLOCKED/)
    legacy.close()
    const retry = new File()
    await retry.writeLine('retried')
    assert.deepEqual(await Array.fromAsync(retry.readLines()), ['retried'])
    await blocked.close(); await retry.close()
  })
})
