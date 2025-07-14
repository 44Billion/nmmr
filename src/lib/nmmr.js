import MMR from '../mmrs/ram/index.js'
import { leafIndexToNodeIndex, bytesToHex, hexToBytes, toSha256 } from './helpers.js'
import EphemeralFile from './ephemeral-file.js'

const isBrowser = typeof window !== 'undefined'
export default class NMMR {
  tree = new MMR()
  leafLength = 0

  async append (value) {
    const valueHash = toSha256(value)
    this.tree.append(null, valueHash)
    this.leafLength++
    this.file ??= new EphemeralFile(`nmmr-leaves-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
    return this.file.writeLine(this.toLine(valueHash, value))
  }

  toLine (hash, data) {
    if (isBrowser) {
      return { hash, data }
    } else {
      return `${bytesToHex(hash)}:${bytesToHex(data)}\n`
    }
  }

  fromLine (line) {
    if (isBrowser) {
      return line
    } else {
      return line.split(':').reduce((r, v, i) => {
        if (i === 0) return { ...r, hash: hexToBytes(v) }
        else return { ...r, data: hexToBytes(v) }
      }, {})
    }
  }

  async * getChunks () {
    let leafIndex = 0 // just conting leaves, not all nodes
    const rootHash = bytesToHex(this.getRoot())
    for await (const line of this.file.readLines()) {
      const { hash: leafValueHash, data: leafValue } = this.fromLine(line)
      const nodeIndex = leafIndexToNodeIndex(leafIndex)
      const proof = this.tree.getProofArray(nodeIndex + 1)

      // this will be used at nostr event
      yield {
        contentBytes: leafValue, // encode to base122 and place at .content
        x: bytesToHex(leafValueHash), // dTag; not the leafHash, which is leafValueHash with a prefix
        index: leafIndex.toString(), // chunk 1/n
        length: this.leafLength.toString(), // n
        rootX: rootHash, // tree identifier
        proof // sibling hashes
      }
      leafIndex++
    }
  }

  // run this after appending every leaf
  getRoot () { return (this.root ??= this.tree.bagThePeaks()) }

  static verifyProof (toVerify, { shouldVerifyContent = !!toVerify.contentBytes } = {}) {
    if (shouldVerifyContent) this.verifyLeafValue(toVerify)

    return MMR.verifyProof(
      toVerify.proof,
      toVerify.index,
      toVerify.length,
      toVerify.x,
      toVerify.rootX
    )
  }

  static verifyLeafValue (toVerify) {
    if (bytesToHex(toSha256(toVerify.contentBytes)) !== toVerify.x) {
      throw new Error('Leaf value hash mismatch')
    }
  }
}
