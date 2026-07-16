import MMR from '../mmrs/ram/index.js'
import {
  leafIndexToNodeIndex,
  bytesToHex,
  hexToBytes,
  toSha256,
  uintToUint8ArrayLike,
  assertSafeUint
} from './helpers.js'
import EphemeralFile from './ephemeral-file.js'

const isBrowser = typeof window !== 'undefined'
const HEX_32 = /^[0-9a-f]{64}$/

function concatBytes (...values) {
  const result = new Uint8Array(values.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

function parseCanonicalUint (value, name, { positive = false } = {}) {
  let number
  if (typeof value === 'number') {
    number = value
  } else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    number = Number(value)
    if (String(number) !== value) throw new Error(`${name} is not a canonical safe integer.`)
  } else {
    throw new Error(`${name} must be a canonical unsigned integer.`)
  }
  assertSafeUint(number, name)
  if (positive && number === 0) throw new Error(`${name} must be positive.`)
  return number
}

function splitProof (proof, hashCount) {
  if (!(proof instanceof Uint8Array)) throw new Error('Proof must be a Uint8Array.')
  if (proof.length !== hashCount * 32) throw new Error('Wrong proof length.')
  return Array.from({ length: hashCount }, (_, index) => proof.slice(index * 32, (index + 1) * 32))
}
export default class NMMR {
  tree = new MMR()
  leafLength = 0

  async append (value) {
    const valueHash = toSha256(value)
    this.tree.append(null, valueHash)
    this.leafLength++
    this.root = undefined
    this.file ??= new EphemeralFile(`nmmr-leaves-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
    return this.file.writeLine(this.toLine(value))
  }

  toLine (data) {
    if (isBrowser) {
      return { data }
    } else {
      return bytesToHex(data)
    }
  }

  fromLine (line) {
    if (isBrowser) {
      return line
    } else {
      return { data: hexToBytes(line) }
    }
  }

  async * getChunks () {
    let leafIndex = 0 // just counting leaves, not all nodes
    for await (const line of this.file.readLines()) {
      const { data: leafValue } = this.fromLine(line)
      const nodeIndex = leafIndexToNodeIndex(leafIndex)
      const proof = this.tree.getProofArray(nodeIndex + 1)

      // this will be used at nostr event
      yield {
        contentBytes: leafValue, // encode to base93 and place at .content
        index: leafIndex,
        total: this.leafLength,
        proof: concatBytes(...proof)
      }
      leafIndex++
    }
  }

  // run this after appending every leaf
  getRoot () { return (this.root ??= bytesToHex(this.tree.bagThePeaks())) }

  static calculateRoot ({ contentBytes, index, total, proof }) {
    if (!(contentBytes instanceof Uint8Array)) throw new Error('contentBytes must be a Uint8Array.')
    index = parseCanonicalUint(index, 'Leaf index')
    total = parseCanonicalUint(total, 'Number of leaves', { positive: true })
    const layout = MMR.getProofLayout(index, total)
    const proofHashes = splitProof(proof, layout.hashCount)
    return bytesToHex(MMR.calculateRoot(proofHashes, index, total, contentBytes))
  }

  static verifyProof ({ root, ...toVerify }) {
    if (!HEX_32.test(root)) throw new Error('Root must be 32 lowercase hex bytes.')
    if (NMMR.calculateRoot(toVerify) !== root) throw new Error('Root hash mismatch.')
    return true
  }

  static deriveChunkId (root, index) {
    if (!HEX_32.test(root)) throw new Error('Root must be 32 lowercase hex bytes.')
    index = parseCanonicalUint(index, 'Leaf index')
    return bytesToHex(toSha256(concatBytes(hexToBytes(root), uintToUint8ArrayLike(index))))
  }
}
