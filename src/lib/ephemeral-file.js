const isBrowser = typeof window !== 'undefined'

let fs, os, path

if (!isBrowser) {
  try {
    fs = await import('node:fs')
    os = await import('node:os')
    path = await import('node:path')
  } catch (err) {
    console.error('Failed to load Node.js modules', err)
  }
}

const DB_NAME = 'ephemeral-files'
const STORE_NAME = 'lines'

export default class EphemeralFile {
  static #isFirstWrite = true
  static #dbPromise
  static async #getDB () {
    if (!EphemeralFile.#dbPromise) {
      let wasJustCreated = false
      EphemeralFile.#dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = (event) => {
          const db = event.target.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { autoIncrement: true })
            store.createIndex('filename', 'filename', { unique: false })
            wasJustCreated = true
          }
        }
      })
      if (!wasJustCreated) await this.clearAll()
    }
    return EphemeralFile.#dbPromise
  }

  static async clearAll () {
    if (!isBrowser) return

    const db = await EphemeralFile.#getDB()
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        resolve()
        return
      }
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      const objectStore = tx.objectStore(STORE_NAME)
      objectStore.clear()
    })
  }

  static #openFilesCount = 0
  #EphemeralFilePath
  #cleanupRegistry
  #filename

  constructor (filename = `ephemeralFile-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`) {
    EphemeralFile.#openFilesCount++
    if (isBrowser) {
      this.#filename = filename
      this.#cleanupRegistry = new FinalizationRegistry(async filename => {
        try {
          const db = await EphemeralFile.#getDB()
          const tx = db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          const index = store.index('filename')
          const cursorRequest = index.openCursor(IDBKeyRange.only(filename))
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (cursor) {
              cursor.delete()
              cursor.continue()
            }
          }
          const maybeClose = () => {
            if (--EphemeralFile.#openFilesCount > 0) return
            db.close()
            EphemeralFile.#dbPromise = null // Allow re-opening
          }
          tx.oncomplete = maybeClose
          tx.onerror = maybeClose
        } catch (err) {
          console.log('Cleanup error:', err)
        }
      })
    } else {
      this.#filename = path.join(os.tmpdir(), DB_NAME, filename)
      this.#cleanupRegistry = new FinalizationRegistry((filePath) => {
        try {
          fs.unlinkSync(filePath)
          --EphemeralFile.#openFilesCount
        } catch (err) {
          if (err.code === 'ENOENT') return // ignore error when triggered by file abscence
          console.log('Cleanup error:', err)
        }
      })
    }
    this.#cleanupRegistry.register(this, this.#filename)
  }

  #contentField
  #maybeSetContentFieldByLine (line) {
    return (this.#contentField ??= typeof strOrObj === 'string'
      ? '__str__'
      : Array.isArray(line)
        ? '__obj__'
        : null
    )
  }
  #maybeSetContentFieldByValue (value) {
    return (this.#contentField ??= ['__str__', '__obj__'].find(v => v in value) ?? null)
  }
  async writeLine (line) {
    if (isBrowser) {
      this.#maybeSetContentFieldByLine(line)
      const db = await EphemeralFile.#getDB()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).add({
        filename: this.#filename,
        ...(this.#contentField
          ? { [this.#contentField]: line }
          : line)
      })
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } else {
      try {
        const dir = path.dirname(this.#filename)
        const doesDirExist = fs.existsSync(dir)
        if (EphemeralFile.#isFirstWrite) {
          if (doesDirExist) {
            // fs.rmSync(dir, { recursive: true, force: true })
            // would also delete the dir itself
            async function clearDirContents (dir) {
              if (!dir.startsWith(os.tmpdir() + '/')) return

              await Promise.all(
                (await fs.promises.readdir(dir)).map(filename =>
                  fs.promises.rm(path.join(dir, filename), {
                    recursive: true,
                    force: true
                  })
                )
              )
            }
            try {
              await clearDirContents(dir)
            } catch (err) {
              console.error(`Error clearing directory ${dir} contents: ${err}`)
            }
          }
          EphemeralFile.#isFirstWrite = false
        }

        if (!doesDirExist) fs.mkdirSync(dir, { recursive: true })
        await fs.promises.appendFile(this.#filename, line + '\n')
      } catch (err) {
        console.error('Error appending to file:', err)
      }
    }
  }

  #getFields ({ filename, ...rest }) { return this.#contentField ? rest[this.#contentField] : rest }
  async * readLines () {
    let file
    try {
      if (isBrowser) {
        const db = await EphemeralFile.#getDB()
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const index = store.index('filename')
        const cursorRequest = index.openCursor(IDBKeyRange.only(this.#filename))

        let cursor = await new Promise((resolve, reject) => {
          cursorRequest.onsuccess = () => resolve(cursorRequest.result)
          cursorRequest.onerror = () => reject(cursorRequest.error)
        })

        while (cursor) {
          this.#maybeSetContentFieldByValue(cursor.value)
          yield this.#getFields(cursor.value)
          cursor.continue()
          cursor = await new Promise((resolve, reject) => {
            cursorRequest.onsuccess = () => resolve(cursorRequest.result)
            cursorRequest.onerror = () => reject(cursorRequest.error)
          })
        }
      } else {
        file = await fs.promises.open(this.#filename)
        for await (const line of file.readLines()) {
          if (line === '') break
          yield line
        }
      }
    } finally {
      await file?.close()
    }
  }
}
