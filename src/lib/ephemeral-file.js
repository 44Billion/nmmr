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
let dbPromise

function getDB () {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true })
        store.createIndex('filename', 'filename', { unique: false })
      }
    }
  }).catch(error => { dbPromise = null; throw error })
  return dbPromise
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
    tx.onerror = () => reject(tx.error)
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
      this.#record = { filename: `${crypto.randomUUID()}:${filename}` }
    } else {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nmmr-'))
      this.#record = { directory, filename: path.join(directory, path.basename(filename)) }
    }
    cleanupRegistry.register(this, this.#record, this)
  }

  #assertOpen () {
    if (this.#closed) throw new Error('TEMPORARY_FILE_CLOSED')
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
      const db = await getDB()
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error || new Error('TEMPORARY_FILE_WRITE_ABORTED'))
        tx.onerror = () => reject(tx.error)
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
      tx.onerror = () => reject(tx.error)
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
