import {
  findPeaks,
  getHeight,
  isPeak,
  parentOffset,
  peakMapHeight,
  siblingOffset,
  toSha256,
  leafIndexToNodeIndex,
  getTreeSizeFromNumberOfLeaves,
  uintToUint8ArrayLike,
  assertSafeUint
} from '../../lib/helpers.js'

// Add a prefix to non-leaf nodes to avoid collisions
// Example without prefix:
//     abcd
//   ab    cd    = abcd root
//  a b   c d
//
//   abcd        = abcd root
//  ab  cd
//
//   ab          = abcd root
//  a b   cd
//
function concatArrays (...arrays) {
  const normalized = arrays.map(value => value instanceof Uint8Array ? value : Uint8Array.from(value))
  const result = new Uint8Array(normalized.reduce((total, value) => total + value.length, 0))
  let offset = 0
  for (const value of normalized) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}
/**
 * @type {{
 * toLeafNode: (data: Uint8Array, mmrSize: number) => Uint8Array;
 * toParentNode: (leftChild: Uint8Array, rightChild: Uint8Array, mmrSize: number) => Uint8Array;
 * toRootNode: (bag: Uint8Array, mmrSize: number) => Uint8Array;
 * concatPeaks: (accRightPeaks: Uint8Array, leftPeak: Uint8Array) => number[];
 * }}
 */
export const nostrFns = {
  // By having this prefix, we can be sure of the correct leaf index
  // It also avoids duplicate leaf hashes
  // Hashing just the data makes it addressable no matter the index
  toLeafNode (data, mmrSize /* prefix */, dataHash = toSha256(data)) {
    return toSha256(concatArrays(uintToUint8ArrayLike(mmrSize - 1), dataHash))
  },
  toParentNode (leftChild, rightChild, mmrSize) {
    return toSha256(concatArrays(uintToUint8ArrayLike(mmrSize - 1), leftChild, rightChild))
  },
  toRootNode (bag, mmrSize) { return toSha256(concatArrays(uintToUint8ArrayLike(mmrSize), bag)) },
  concatPeaks (accRightPeaks, leftPeak) { return concatArrays(leftPeak, accRightPeaks) }
}

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
   * Creates an instance of MMR.
   * @param {object} [fns=nostrFns]
   * @param {(data: Uint8Array, mmrSize: number) => Uint8Array} [fns.toLeafNode]
   * @param {(leftChild: Uint8Array, rightChild: Uint8Array, mmrSize: number) => Uint8Array} [fns.toParentNode]
   * @param {(bag: Uint8Array, mmrSize: number) => Uint8Array} [fns.toRootNode]
   * @param {(accRightPeaks: Uint8Array, leftPeak: Uint8Array) => number[]} [fns.concatPeaks]
   * @param {object} [options]
   * @param {boolean} [options.isDebugging=false]
   */
  constructor (fns = nostrFns, options) { Object.assign(this, fns, options, options?.isDebugging && { values: {} }) }

  /**
   * @param {string|Uint8Array} value
   * @param {?Uint8Array} [valueHash]
   * @returns {Promise<{leavesCount: number, leafIdx: string, rootHash: string|undefined, lastPos: number}>}
   */
  append (value, valueHash) {
    // Increment position
    if (!Number.isSafeInteger(this.lastPos + 1)) throw new Error('MMR node position would be unsafe.')
    this.lastPos++

    const hash = this.toLeafNode(value, this.lastPos, valueHash)
    this.hashes[this.lastPos] = hash
    if (this.isDebugging) this.values[this.lastPos] = value

    let height = 0
    const pos = this.lastPos

    // If the height of the next node is higher then the height of current node
    // It means that the next node is a parent of current, thus merging happens
    while (getHeight(this.lastPos + 1) > height) {
      if (!Number.isSafeInteger(this.lastPos + 1)) throw new Error('MMR parent position would be unsafe.')
      this.lastPos++

      const left = this.lastPos - parentOffset(height)
      const right = left + siblingOffset(height)

      const parentHash = this.toParentNode(this.hashes[left], this.hashes[right], this.lastPos)
      this.hashes[this.lastPos] = parentHash

      height++
    }

    if (this.isDebugging) {
      // Compute the new root hash
      this.rootHash = this.bagThePeaks()
    }

    ++this.leaves
    return {
      leavesCount: this.leaves,
      leafIdx: pos.toString(),
      lastPos: this.lastPos,
      ...(this.isDebugging && { rootHash: this.rootHash })
    }
  }

  /**
   * @param {*} [peaks=findPeaks(this.lastPos)]
   * @returns {Promise<string>}
   */
  bagThePeaks (peaks = findPeaks(this.lastPos)) {
    if (!peaks.length) throw new Error('Expected peaks to bag')

    let bags = this.hashes[peaks[peaks.length - 1]]
    for (let idx = peaks.length - 2; idx >= 0; --idx) {
      bags = this.concatPeaks(bags, this.hashes[peaks[idx]])
    }
    const treeSize = this.lastPos
    const rootHash = this.toRootNode(bags, treeSize)
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
  static isLeftSibling (idx) {
    const [peakMap, height] = peakMapHeight(idx - 1)
    const peak = 1n << BigInt(height)
    return (BigInt(peakMap) & peak) === 0n
  }

  /**
   * @param {number} idx
   * @returns {Promise<{index: number, value: string, peaks: number[], peaksHashes: string[], siblingHashes: string[], lastVisitedNodeIdx: number}>}
   */
  getProof (idx) {
    if (idx <= 0) throw new Error('Index starts at one')
    if (idx > this.lastPos) throw new Error('Index out of range')
    if (!this.isLeaf(idx)) throw new Error('Expected a leaf node')

    const index = idx
    let value
    if (this.isDebugging) {
      value = this.values[idx]
      if (!value) throw new Error(`Expected value for index ${idx}`)
    }

    const peaks = findPeaks(this.lastPos)
    const peaksHashes = peaks.map((p) => this.hashes[p])
    let height
    const siblingHashes = [] // Proof
    while (!isPeak(idx, peaks)) {
      height = getHeight(idx)
      const hash = this.hashes[idx]
      if (!hash) throw new Error(`Expected a hash value for node ${idx}`)

      const isLeft = MMR.isLeftSibling(idx)
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
      peaks, // Peaks indexes
      peaksHashes, // Peak hashes
      siblingHashes, // Path (sibling hashes)
      ...(this.isDebugging && {
        value, // Proving slot value
        lastVisitedNodeIdx: idx // Debug only
      })
    }
  }

  /**
   * @param {number} idx The leaf node index, not the leaf-only array index
   * @returns {Array<*>}
   */
  getProofArray (idx) {
    if (idx <= 0) throw new Error('Index starts at one')
    if (idx > this.lastPos) throw new Error('Index out of range')
    if (!this.isLeaf(idx)) throw new Error('Expected a leaf node')

    const proof = []

    // sibling hashes
    let currentIdx = idx
    const peaks = findPeaks(this.lastPos)
    while (!isPeak(currentIdx, peaks)) {
      const height = getHeight(currentIdx)
      const isLeft = MMR.isLeftSibling(currentIdx)
      const siblingOfs = siblingOffset(height)
      const siblingIdx = isLeft ? currentIdx + siblingOfs : currentIdx - siblingOfs
      const siblingHash = this.hashes[siblingIdx]
      if (!siblingHash) throw new Error(`Expected a hash value for sibling ${currentIdx}`)
      proof.push(siblingHash)

      const parentOfs = parentOffset(height)
      currentIdx = isLeft ? currentIdx + parentOfs : siblingIdx + parentOfs
    }

    // add peaks but not the one that is an ancestor of idx because
    // it will be calculated from the leaf
    proof.push(...peaks.filter(p => p !== currentIdx).map(p => this.hashes[p]))

    return proof
  }

  /**
   * @param {MMRProof} proof
   * @param {Uint8Array} hash
   * @param {Uint8Array} rootHash
   * @returns {*}
   */
  verifyProof (proof, hash /* leaf */, rootHash = this.rootHash) {
    hash ??= this.toLeafNode(proof.value, proof.index)
    const topHash = this.bagThePeaks(proof.peaks)
    if (topHash !== rootHash) {
      throw new Error('Top hash is not equal to this MMR root hash')
    }

    if (this.isDebugging) {
      const storedHash = this.hashes[proof.index]
      if (hash !== storedHash) {
        throw new Error('Hash mismatch')
      }
    }
    let height
    let siblingN = 0
    let idx = proof.index
    while (!isPeak(idx, proof.peaks)) {
      height = getHeight(idx)
      const isLeft = MMR.isLeftSibling(idx)
      const siblingHash = proof.siblingHashes[siblingN]
      if (!siblingHash) throw new Error('Expected sibling hash')
      const siblingOfs = siblingOffset(height)
      const siblingIdx = isLeft ? idx + siblingOfs : idx - siblingOfs
      if (this.isDebugging) {
        const storedSiblingHash = this.hashes[siblingIdx]
        if (siblingHash !== storedSiblingHash) {
          throw new Error('Sibling mismatch')
        }
      }
      const parentOfs = parentOffset(height)
      const parentIdx = isLeft ? idx + parentOfs : siblingIdx + parentOfs
      const children = isLeft ? [hash, siblingHash] : [siblingHash, hash]
      const parentHash = this.toParentNode(children[0], children[1], parentIdx)
      if (this.isDebugging) {
        const storedParentHash = this.hashes[parentIdx]
        if (parentHash !== storedParentHash) {
          throw new Error('Parent mismatch')
        }
      }
      idx = parentIdx // Jump to parent
      hash = parentHash
      siblingN += 1
    }
  }

  // Doesn't need this.hashes
  static getProofLayout (leafIndex, leavesLength) {
    assertSafeUint(leafIndex, 'Leaf index')
    assertSafeUint(leavesLength, 'Number of leaves')
    if (leavesLength === 0) throw new Error('Number of leaves must be positive.')
    if (leafIndex >= leavesLength) throw new Error('Leaf index is out of range.')

    const zeroBasedNodeIndex = leafIndexToNodeIndex(leafIndex)
    if (!Number.isSafeInteger(zeroBasedNodeIndex + 1)) throw new Error('Leaf position would be unsafe.')
    const nodeIndex = zeroBasedNodeIndex + 1
    const lastPos = getTreeSizeFromNumberOfLeaves(leavesLength)
    const peaks = findPeaks(lastPos)
    if (peaks.length === 0) throw new Error('Wrong tree size.')

    let currentIdx = nodeIndex
    let siblingCount = 0
    while (!isPeak(currentIdx, peaks)) {
      const height = getHeight(currentIdx)
      const isLeft = MMR.isLeftSibling(currentIdx)
      const parentOfs = parentOffset(height)
      currentIdx = isLeft
        ? currentIdx + parentOfs
        : currentIdx - siblingOffset(height) + parentOfs
      siblingCount++
    }

    return {
      nodeIndex,
      lastPos,
      peaks,
      targetPeakIndex: peaks.indexOf(currentIdx),
      siblingCount,
      hashCount: siblingCount + peaks.length - 1
    }
  }

  /**
   * Calculate a root from a leaf value and an ordered array of proof hashes.
   *
   * @param {Array<*>} proof
   * @param {number} leafIndex
   * @param {number} leavesLength
   * @param {*} leafValue
   * @param {object} fns
   * @returns {*}
   */
  static calculateRoot (proof, leafIndex, leavesLength, leafValue, fns = nostrFns) {
    const layout = MMR.getProofLayout(leafIndex, leavesLength)
    if (!Array.isArray(proof) || proof.length !== layout.hashCount) throw new Error('Wrong proof length.')

    let currentHash = fns.toLeafNode(leafValue, layout.nodeIndex)
    let currentIdx = layout.nodeIndex
    for (let siblingN = 0; siblingN < layout.siblingCount; siblingN++) {
      const height = getHeight(currentIdx)
      const isLeft = MMR.isLeftSibling(currentIdx)
      const parentOfs = parentOffset(height)
      const parentIdx = isLeft
        ? currentIdx + parentOfs
        : currentIdx - siblingOffset(height) + parentOfs
      const siblingHash = proof[siblingN]
      const children = isLeft ? [currentHash, siblingHash] : [siblingHash, currentHash]
      currentHash = fns.toParentNode(children[0], children[1], parentIdx)
      currentIdx = parentIdx
    }

    const otherPeaks = proof.slice(layout.siblingCount)
    let otherPeakIndex = 0
    const allPeaks = layout.peaks.map((_, index) => (
      index === layout.targetPeakIndex ? currentHash : otherPeaks[otherPeakIndex++]
    ))

    let bag = allPeaks[allPeaks.length - 1]
    for (let i = allPeaks.length - 2; i >= 0; i--) bag = fns.concatPeaks(bag, allPeaks[i])
    return fns.toRootNode(bag, layout.lastPos)
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
export default MMR
