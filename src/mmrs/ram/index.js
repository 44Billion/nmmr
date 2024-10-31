import { pedersen } from '../../pkg/pedersen_wasm.js'
import {
  findPeaks,
  getHeight,
  isPeak,
  parentOffset,
  peakMapHeight,
  siblingOffset,
} from '../../lib/helpers.js'

/**
 * @export
 * @class MMR
 * @typedef {MMR}
 */
export class MMR {
  hashes = {}
  values = {}
  lastPos = 0 // Tree size (total number of nodes, including leaves)
  rootHash = ''
  leaves = 0

  /**
   * @async
   * @param {string} value
   * @returns {Promise<{leavesCount: number, leafIdx: string, rootHash: string|undefined, lastPos: number}>}
   */
  async append (value) {
    // Increment position
    this.lastPos++

    const hash = pedersen(this.lastPos.toString(), value);
    this.hashes[this.lastPos] = hash
    this.values[this.lastPos] = value

    let height = 0
    const pos = this.lastPos

    // If the height of the next node is higher then the height of current node
    // It means that the next node is a parent of current, thus merging happens
    while (getHeight(this.lastPos + 1) > height) {
      this.lastPos++

      const left = this.lastPos - parentOffset(height)
      const right = left + siblingOffset(height)

      const parentHash = pedersen(
        this.lastPos.toString(),
        pedersen(this.hashes[left], this.hashes[right])
      )
      this.hashes[this.lastPos] = parentHash

      height++
    }

    // Compute the new root hash
    this.rootHash = await this.bagThePeaks()

    ++this.leaves
    return {
      leavesCount: this.leaves,
      leafIdx: pos.toString(),
      rootHash: this.rootHash,
      lastPos: this.lastPos
    }
  }

  /**
   * @async
   * @param {*} [peaks=findPeaks(this.lastPos)]
   * @returns {Promise<string>}
   */
  async bagThePeaks (peaks = findPeaks(this.lastPos)) {
    if (!peaks.length) throw new Error('Expected peaks to bag')

    let bags = this.hashes[peaks[peaks.length - 1]]
    for (let idx = peaks.length - 1; idx >= 0; --idx) {
      bags = pedersen(bags, this.hashes[peaks[idx]])
    }
    const treeSize = this.lastPos
    const rootHash = pedersen(treeSize.toString(), bags)
    return rootHash
  }

  /**
   * @param {number} idx
   * @returns {boolean}
   */
  isLeaf (idx) {
    return getHeight(idx) === 0
  }

  /**
   * @param {number} idx
   * @returns {boolean}
   */
  isLeftSibling (idx) {
    const [peakMap, height] = peakMapHeight(idx - 1)
    const peak = 1 << height
    return (peakMap & peak) === 0
  }

  /**
   * @async
   * @param {number} idx
   * @returns {Promise<{index: number, value: string, peaks: number[], peaksHashes: string[], siblingHashes: string[], lastVisitedNodeIdx: number}>}
   */
  async getProof (idx) {
    if (idx <= 0) throw new Error('Index starts at one')
    if (idx > this.lastPos) throw new Error('Index out of range')
    if (!this.isLeaf(idx)) throw new Error('Expected a leaf node')

    const index = idx
    const value = this.values[idx]
    if (!value) throw new Error(`Expected value for index ${idx}`)

    const peaks = findPeaks(this.lastPos)
    const peaksHashes = peaks.map((p) => this.hashes[p])
    let height
    const siblingHashes = [] // Proof
    while (!isPeak(idx, peaks)) {
      height = getHeight(idx)
      const hash = this.hashes[idx]
      if (!hash) throw new Error(`Expected a hash value for node ${idx}`)

      const isLeft = this.isLeftSibling(idx)
      const siblingOfs = siblingOffset(height)
      const siblingIdx = isLeft ? idx + siblingOfs : idx - siblingOfs
      const siblingHash = this.hashes[siblingIdx]
      if (!siblingHash) throw new Error(`Expected a hash value for sibling ${idx}`)
      siblingHashes.push(siblingHash)

      const parentOfs = parentOffset(height)
      const parentIdx = isLeft ? idx + parentOfs : siblingIdx + parentOfs
      const parentHash = this.hashes[parentIdx]
      if (!parentHash) throw new Error(`Expected a hash value for parent ${idx}`)

      idx = parentIdx // Jump to parent
    }
    return {
      index, // Proving slot index
      value, // Proving slot value
      peaks, // Peaks indexes
      peaksHashes, // Peak hashes
      siblingHashes, // Path (sibling hashes)
      lastVisitedNodeIdx: idx // Debug only
    }
  }

  /**
   * @async
   * @param {MMRProof} proof
   * @returns {*}
   */
  async verifyProof (proof) {
    let hash = pedersen(proof.index.toString(), proof.value);
    const storedHash = this.hashes[proof.index]
    if (hash !== storedHash) {
      throw new Error('Hash mismatch')
    }
    let height
    let siblingN = 0
    let idx = proof.index
    while (!isPeak(idx, proof.peaks)) {
      height = getHeight(idx)
      const isLeft = this.isLeftSibling(idx)
      const siblingHash = proof.siblingHashes[siblingN]
      if (!siblingHash) throw new Error('Expected sibling hash')
      const siblingOfs = siblingOffset(height)
      const siblingIdx = isLeft ? idx + siblingOfs : idx - siblingOfs
      const storedSiblingHash = this.hashes[siblingIdx]
      if (siblingHash !== storedSiblingHash) {
        throw new Error('Sibling mismatch')
      }
      const parentOfs = parentOffset(height)
      const parentIdx = isLeft ? idx + parentOfs : siblingIdx + parentOfs
      const parentHash = pedersen(
        parentIdx.toString(),
        isLeft
          ? pedersen(hash, siblingHash)
          : pedersen(siblingHash, hash)
      )
      const storedParentHash = this.hashes[parentIdx]
      if (parentHash !== storedParentHash) {
        throw new Error('Parent mismatch')
      }
      idx = parentIdx // Jump to parent
      hash = parentHash
      siblingN += 1
    }
    const topHash = await this.bagThePeaks(proof.peaks)
    if (topHash !== this.rootHash) {
      throw new Error('Top hash is not equal to this MMR root hash')
    }
  }

  /**
   * @param {?number} [givenLastPos]
   * @returns {number[]}
   */
  retrievePeaksIndexes (givenLastPos) {
    const lastPos = givenLastPos ?? this.lastPos
    const peaksIndexes = findPeaks(lastPos)
    return peaksIndexes
  }

  /**
   * @param {?number} [givenLastPos]
   * @returns {string[]}
   */
  retrievePeaksHashes (givenLastPos) {
    if (givenLastPos && givenLastPos > this.lastPos) throw new Error('Given position cannot exceed last position')

    const lastPos = givenLastPos ?? this.lastPos
    const peaksIndexes = findPeaks(lastPos)
    const peaksHashes = peaksIndexes.map(peakIdx => this.hashes[peakIdx])
    return peaksHashes
  }
}
