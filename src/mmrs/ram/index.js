import {
  findPeaks,
  getHeight,
  isPeak,
  parentOffset,
  peakMapHeight,
  siblingOffset,
  toSha256,
  bytesToHex,
  hexToBytes,
  leafIndexToNodeIndex,
  getTreeSizeFromNumberOfLeaves
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
// Return shortest unit8Array size (not fixed size)
function uintToUint8ArrayLike (n, bytes = []) {
  do { bytes.unshift(n & 255) } while ((n >>= 8) > 0)
  return bytes
}
// It works for Uint8Arrays
function concatArrays (...arrays) { return arrays.reduce((r, v) => [...r, ...v]) }
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
  // Decided to not do toSha256(theReturn) because dataHash is alreasy sha256,
  // we would be hashing twice.
  // Also, didn't want to have to carry both
  // - the leaf value hash to prove the chunk data is correct and make it content-addressable
  // - the leaf hash to prove the chunk is part of the full data
  toLeafNode (data, mmrSize /* prefix */, dataHash = toSha256(data)) { return new Uint8Array(concatArrays(uintToUint8ArrayLike(mmrSize - 1), dataHash)) },
  toParentNode (leftChild, rightChild, mmrSize) {
    return toSha256(new Uint8Array(concatArrays(uintToUint8ArrayLike(mmrSize - 1), leftChild, rightChild)))
  },
  toRootNode (bag, mmrSize) { return toSha256(new Uint8Array(concatArrays(uintToUint8ArrayLike(mmrSize), bag))) },
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
    this.lastPos++

    const hash = this.toLeafNode(value, this.lastPos, valueHash)
    this.hashes[this.lastPos] = hash
    if (this.isDebugging) this.values[this.lastPos] = value

    let height = 0
    const pos = this.lastPos

    // If the height of the next node is higher then the height of current node
    // It means that the next node is a parent of current, thus merging happens
    while (getHeight(this.lastPos + 1) > height) {
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
    const peak = 1 << height
    return (peakMap & peak) === 0
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
   * @returns {string[]}
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
      proof.push(bytesToHex(siblingHash))

      const parentOfs = parentOffset(height)
      currentIdx = isLeft ? currentIdx + parentOfs : siblingIdx + parentOfs
    }

    // add peaks but not the one that is an ancestor of idx because
    // it will be calculated from the leaf
    proof.push(...peaks.filter(p => p !== currentIdx).map(p => bytesToHex(this.hashes[p])))

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
  /**
   * @param {string[]} proof
   * @param {string} rootHashHex
   * @returns {boolean}
   */
  static verifyProof (proof, leafIdxStr, leavesLengthStr, leafValueHashHex, rootHashHex, fns = nostrFns) {
    const leafIndex = leafIndexToNodeIndex(parseInt(leafIdxStr, 10)) + 1 // Convert back to 1-indexed
    const lastPos = getTreeSizeFromNumberOfLeaves(parseInt(leavesLengthStr, 10))
    if (!Number.isInteger(lastPos) || lastPos <= 0) throw new Error('Wrong tree size')

    const peaks = findPeaks(lastPos)
    const peaksCount = peaks.length
    const siblingHashesHex = proof.slice(0, proof.length - (peaksCount - 1))
    const peaksHashesHex = proof.slice(proof.length - (peaksCount - 1))
    const calculatedLeafHash = fns.toLeafNode(null, leafIndex, hexToBytes(leafValueHashHex))

    let currentHash = calculatedLeafHash
    let currentIdx = leafIndex
    let siblingN = 0

    while (siblingN < siblingHashesHex.length) {
      const height = getHeight(currentIdx)
      const isLeft = MMR.isLeftSibling(currentIdx)
      const siblingHash = hexToBytes(siblingHashesHex[siblingN])

      const parentOfs = parentOffset(height)
      const parentIdx = isLeft ? currentIdx + parentOfs : currentIdx - siblingOffset(height) + parentOfs

      const children = isLeft ? [currentHash, siblingHash] : [siblingHash, currentHash]
      currentHash = fns.toParentNode(children[0], children[1], parentIdx)

      currentIdx = parentIdx
      siblingN++
    }

    // Bag the peaks.
    const allPeaks = [currentHash, ...peaksHashesHex.map(hexToBytes)]
    let calculatedRoot = allPeaks[allPeaks.length - 1]
    for (let i = allPeaks.length - 2; i >= 0; i--) {
      calculatedRoot = fns.concatPeaks(calculatedRoot, allPeaks[i])
    }

    const finalRoot = fns.toRootNode(calculatedRoot, lastPos)

    if (bytesToHex(finalRoot) !== rootHashHex) {
      throw new Error('Root hash mismatch')
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
export default MMR
