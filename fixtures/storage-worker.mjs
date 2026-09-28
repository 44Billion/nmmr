import NMMR from '../src/index.js'
import EphemeralFile from '../src/lib/ephemeral-file.js'
import { promises as fs } from 'node:fs'

let mmr
let files
process.on('message', async ({ id, action }) => {
  try {
    let result
    if (action === 'write') {
      mmr = new NMMR()
      await mmr.append(Uint8Array.of(1, 2, 3))
      result = mmr.getRoot()
    } else if (action === 'read') {
      result = []
      for await (const chunk of mmr.getChunks()) {
        NMMR.verifyProof({ ...chunk, root: mmr.getRoot() })
        result.push([...chunk.contentBytes])
      }
    } else if (action === 'concurrent') {
      files = Array.from({ length: 8 }, () => new EphemeralFile('same-name.txt'))
      await Promise.all(files.map((file, index) => file.writeLine(String(index))))
      result = await Promise.all(files.map(async file => Array.fromAsync(file.readLines())))
    } else if (action === 'writeFailure') {
      const file = new EphemeralFile()
      const original = fs.appendFile
      fs.appendFile = async () => { throw new Error('ENOSPC: injected write failure') }
      try { await file.writeLine('must reject') } finally { fs.appendFile = original; await file.close() }
    } else if (action === 'close') {
      await mmr?.close()
      await Promise.all((files || []).map(file => file.close()))
    }
    process.send({ id, result })
  } catch (error) { process.send({ id, error: error.message }) }
})
