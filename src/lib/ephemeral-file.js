const isBrowser = typeof window !== 'undefined'

let fs, os, path
if (!isBrowser) {
  // Optional imports keep browser bundlers from requiring Node built-ins.
  try {
    fs = await import('node:fs')
    os = await import('node:os')
    path = await import('node:path')
  } catch (cause) {
    throw new Error('NODE_TEMPORARY_STORAGE_UNAVAILABLE', { cause })
  }
}

const DB_NAME = 'ephemeral-files'
const STORE_NAME = 'lines'
const SESSION_STORE = 'nmmr-sessions'
const sessionId = isBrowser ? crypto.randomUUID() : null
const sessionPrefix = id => `nmmr-session:${id}:`
const sessionLock = id => `nmmr:ephemeral-files:session:${id}`
let dbPromise
let sessionPromise
let currentSession

function getDB () {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    let blocked = false
    request.onblocked = () => {
      blocked = true
      reject(new Error('TEMPORARY_STORAGE_UPGRADE_BLOCKED'))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true })
        store.createIndex('filename', 'filename', { unique: false })
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
    }
  }).catch(error => { dbPromise = null; throw error })
  return dbPromise
}

function transactionDone (tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error || new Error('TEMPORARY_STORAGE_TRANSACTION_ABORTED'))
  })
}

async function collectAbandonedSessions (db, locks) {
  const tx = db.transaction(SESSION_STORE, 'readonly')
  const done = transactionDone(tx)
  const request = tx.objectStore(SESSION_STORE).getAllKeys()
  await done
  for (const id of request.result) {
    if (id === sessionId) continue
    // Acquisition, rather than a lock snapshot or heartbeat, protects the
    // entire deletion against other collectors and concurrent initialization.
    await locks.request(sessionLock(id), { ifAvailable: true }, async lock => {
      if (!lock) return
      const tx = db.transaction([STORE_NAME, SESSION_STORE], 'readwrite')
      const done = transactionDone(tx)
      const prefix = sessionPrefix(id)
      const rows = tx.objectStore(STORE_NAME).index('filename').openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
      rows.onsuccess = () => {
        const cursor = rows.result
        if (cursor) { cursor.delete(); cursor.continue() }
      }
      tx.objectStore(SESSION_STORE).delete(id)
      await done
    })
  }
}

async function initializeBrowserSession () {
  const locks = globalThis.navigator?.locks
  // Rows created without a lifetime lock have no collectible session marker.
  if (!locks?.request) return
  const db = await getDB()
  const ready = Promise.withResolvers()
  const lifetime = Promise.withResolvers()
  const session = { active: false }
  const holding = locks.request(sessionLock(sessionId), async () => {
    session.active = true
    ready.resolve()
    await lifetime.promise
    session.active = false
  })
  holding.catch(error => { session.active = false; ready.reject(error) })
  await ready.promise
  currentSession = session
  try {
    // Publish ownership only after acquiring the lock, before any leaf writes.
    const tx = db.transaction(SESSION_STORE, 'readwrite')
    const done = transactionDone(tx)
    tx.objectStore(SESSION_STORE).put(true, sessionId)
    await done
    await collectAbandonedSessions(db, locks)
  } catch (error) {
    lifetime.resolve()
    await holding.catch(() => {})
    currentSession = null
    throw error
  }
  // The browser releases this lock on document termination, including when
  // close()/finalizers did not run. No unload handler or periodic timer needed.
}

function ensureBrowserSession () {
  sessionPromise ??= initializeBrowserSession().catch(error => { sessionPromise = null; throw error })
  return sessionPromise
}

async function removeOwnedFile ({ directory, filename }) {
  if (!isBrowser) {
    await fs.promises.rm(directory, { recursive: true, force: true })
    return
  }
  const db = await getDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error || new Error('TEMPORARY_FILE_DELETE_ABORTED'))
    const request = tx.objectStore(STORE_NAME).index('filename').openCursor(IDBKeyRange.only(filename))
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
  })
}

// The registry must outlive its targets and must not capture a file instance.
// Finalization is best effort; close() provides deterministic owned cleanup.
const cleanupRegistry = new FinalizationRegistry(record => { removeOwnedFile(record).catch(() => {}) })

export default class EphemeralFile {
  #record
  #contentField
  #writes = Promise.resolve()
  #closed = false
  #closing

  constructor (filename = 'leaves.txt') {
    if (isBrowser) {
      this.#record = { filename: `${sessionPrefix(sessionId)}${crypto.randomUUID()}:${filename}` }
    } else {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nmmr-'))
      this.#record = { directory, filename: path.join(directory, path.basename(filename)) }
    }
    cleanupRegistry.register(this, this.#record, this)
  }

  #assertOpen () {
    if (this.#closed) throw new Error('TEMPORARY_FILE_CLOSED')
    if (currentSession && !currentSession.active) throw new Error('TEMPORARY_STORAGE_SESSION_ENDED')
  }

  async writeLine (line) {
    this.#assertOpen()
    this.#contentField ??= typeof line === 'string' ? '__str__' : Array.isArray(line) ? '__obj__' : null
    // Snapshot browser values before waiting for preceding writes.
    const value = isBrowser ? structuredClone(line) : line
    const write = this.#writes.then(async () => {
      if (!isBrowser) {
        await fs.promises.appendFile(this.#record.filename, value + '\n', { mode: 0o600 })
        return
      }
      await ensureBrowserSession()
      const db = await getDB()
      if (currentSession && !currentSession.active) throw new Error('TEMPORARY_STORAGE_SESSION_ENDED')
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error || new Error('TEMPORARY_FILE_WRITE_ABORTED'))
        tx.objectStore(STORE_NAME).add({
          ...(this.#contentField ? { [this.#contentField]: value } : value),
          filename: this.#record.filename
        })
      })
    })
    this.#writes = write
    return write
  }

  async #readPage (after) {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const rows = []
      const tx = db.transaction(STORE_NAME, 'readonly')
      tx.oncomplete = () => resolve(rows)
      tx.onabort = () => reject(tx.error || new Error('TEMPORARY_FILE_READ_ABORTED'))
      const request = tx.objectStore(STORE_NAME).index('filename').openCursor(IDBKeyRange.only(this.#record.filename))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (after !== null && cursor.primaryKey <= after) {
          cursor.continuePrimaryKey(this.#record.filename, after + 1)
          return
        }
        rows.push({ key: cursor.primaryKey, value: cursor.value })
        if (rows.length < 128) cursor.continue()
      }
    })
  }

  async * readLines () {
    this.#assertOpen()
    await this.#writes
    if (isBrowser) {
      let after = null
      while (true) {
        this.#assertOpen()
        const rows = await this.#readPage(after)
        if (!rows.length) return
        for (const { key, value: { filename, ...value } } of rows) {
          this.#assertOpen()
          yield this.#contentField ? value[this.#contentField] : value
          after = key
        }
      }
    } else {
      const file = await fs.promises.open(this.#record.filename)
      try {
        for await (const line of file.readLines()) {
          this.#assertOpen()
          yield line
        }
      } finally { await file.close() }
    }
  }

  close () {
    this.#closed = true
    this.#closing ??= (async () => {
      await this.#writes.catch(() => {})
      await removeOwnedFile(this.#record)
      cleanupRegistry.unregister(this)
    })().catch(error => { this.#closing = null; throw error })
    return this.#closing
  }
}
