/**
 * Find the peaks (if any) of a tree of size `num`.
 *
 * @param {number} num
 * @returns {number[]}
 */
export const findPeaks = num => {
  if (num === 0) return []

  // Check for siblings without parents
  if (getHeight(num + 1) > getHeight(num)) return []

  let top = 1
  while (top - 1 <= num) {
    top <<= 1
  }
  top = (top >> 1) - 1
  if (top === 0) {
    return [1]
  }

  const peaks = [top]
  let peak = top
  let outer = true
  while (outer) {
    peak = bintreeJumpRightSibling(peak)
    while (peak > num) {
      peak = bintreeMoveDownLeft(peak)
      if (peak === 0) {
        outer = false
        break
      }
    }
    if (outer) peaks.push(peak)
  }
  return peaks
}

/**
 * Returns true if a specified index `num` is also the index of a peak inside `peaks`.
 *
 * @param {number} num
 * @param {number[]} peaks
 * @returns {boolean}
 */
export const isPeak = (num, peaks) =>
  peaks.indexOf(num) !== -1

/**
 * Returns the number of bits in num
 *
 * @export
 * @param {number} num
 * @returns {number}
 */
export function bitLength (num) {
  return num.toString(2).length
}

/**
 * Number with all bits 1 with the same length as num
 *
 * @export
 * @param {number} num
 * @returns {boolean}
 */
export function allOnes (num) {
  // eslint-disable-next-line eqeqeq
  return (1 << bitLength(num)) - 1 == num
}

/**
 * Returns the number of leading zeros of a uint64.
 *
 * @export
 * @param {number} num
 * @returns {number}
 */
export function leadingZeros (num) {
  return num === 0 ? 64 : 64 - bitLength(num)
}

/**
 * Get the peak map height.
 * Notice this fn has a uint64 size limit.
 *
 * @export
 * @param {number} size
 * @returns {Array}
 */
export function peakMapHeight (size) {
  if (size === 0) {
    return [0, 0]
  }
  let peakSize =
      // uint64 size
      BigInt('18446744073709551615') >> BigInt(leadingZeros(size))
  let peakMap = 0
  // eslint-disable-next-line eqeqeq
  while (peakSize != BigInt(0)) {
    peakMap <<= 1
    if (size >= peakSize) {
      size -= Number(peakSize)
      peakMap |= 1
    }
    peakSize >>= BigInt(1)
  }
  return [peakMap, size]
}

/**
 * Assuming the first position starts with index 1
 * the height of a node correspond to the number of 1 digits (in binary)
 * on the leftmost branch of the tree, minus 1
 * To travel left on a tree we can subtract the position by it's MSB, minus 1
 *
 * @param {number} num
 * @returns {number}
 */
export const getHeight = num => {
  let h = num
  // Travel left until reaching leftmost branch (all bits 1)
  while (!allOnes(h)) {
    h = h - ((1 << (bitLength(h) - 1)) - 1)
  }

  return bitLength(h) - 1
}

/**
 * Get the offset to the next sibling from `height`
 *
 * @param {number} height
 * @returns {number}
 */
export const siblingOffset = height => {
  return (2 << height) - 1
}

/**
 * Get the offset to the next parent from `height`
 *
 * @param {number} height
 * @returns {number}
 */
export const parentOffset = height => {
  return 2 << height
}

/**
 * Jump to the next right sibling from `num`
 *
 * @param {number} num
 * @returns {number}
 */
const bintreeJumpRightSibling = num => {
  const height = getHeight(num)
  return num + (1 << (height + 1)) - 1
}

/**
 * Jump down left from `num`
 *
 * @param {number} num
 * @returns {number}
 */
const bintreeMoveDownLeft = num => {
  const height = getHeight(num)
  if (height === 0) {
    return 0
  }
  return num - (1 << height)
}

/**
 * Calculates the Hamming weight (popcount) of a non-negative integer.
 * Popcount is the number of set bits (1s) in the binary representation of the number.
 * @param {number} num The integer for which to calculate the popcount.
 * @returns {number} The popcount of the number.
 */
function popcount (num) {
  if (num < 0) throw new Error('Input to popcount must be non-negative.')
  let count = 0
  let tempNum = num
  while (tempNum > 0) {
    tempNum &= (tempNum - 1) // Brian Kernighan's algorithm: clears the least significant set bit
    count++
  }
  return count
}

// leafIndexToNodeIndex(7) => 11
/**
 * Calculates the Merkle Mountain Range (MMR) node index for the nth added leaf.
 * This function assumes a 0-indexed leaf count and a 0-indexed node index.
 *
 * @param {number} n The 0-indexed position of the leaf (e.g., 0 for the first leaf, 1 for the second).
 * @returns {number} The 0-indexed MMR node index for the specified leaf.
 */
export function leafIndexToNodeIndex (n) {
  if (n < 0) throw new Error('Leaf index (n) must be non-negative.')

  // The core formula for calculating the MMR node index
  // This assumes the MMR's internal nodes are counted towards the total node index
  // in a compacted, left-to-right manner.
  return n + (n - popcount(n))
}

// getTreeSizeFromNumberOfLeaves(8) => 14
/**
 * Calculates the tree size, without the root.
 * This formula assumes a 0-indexed leaf count and a 0-indexed node index.
 *
 * @param {number} n The total number of leaves.
 * @returns {number} The total number of nodes. (higher peak 0-indexed index + 1)
 */
export function getTreeSizeFromNumberOfLeaves (n) {
  if (n < 0) throw new Error('Number of leaves (n) must be a non-negative integer.')

  // The formula: 2 * n - popcount(n)
  // n = number of leaves
  // popcount(n) = number of peaks (which is also the number of perfect trees that compose the MMR)
  return (2 * n) - popcount(n)
}

export function bytesToHex (uint8aBytes) {
  return Array.from(uint8aBytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes (hexString) {
  const arr = new Uint8Array(hexString.length / 2) // create result array
  for (let i = 0; i < arr.length; i++) {
    const j = i * 2
    const h = hexString.slice(j, j + 2)
    const b = Number.parseInt(h, 16) // byte, created from string part
    if (Number.isNaN(b) || b < 0) throw new Error('invalid hex')
    arr[i] = b
  }
  return arr
}

import { sha256 } from '@noble/hashes/sha256'
export function toSha256 (bytes) { return sha256.create().update(bytes).digest() }
