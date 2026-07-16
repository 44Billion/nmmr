/**
 * Find the peaks (if any) of a tree of size `num`.
 *
 * @param {number} num
 * @returns {number[]}
 */
export const findPeaks = num => {
  assertSafeUint(num, 'MMR size')
  if (num === 0) return []

  const peaks = []
  let consumed = 0
  let remaining = num
  let previousHeight = Infinity

  while (remaining > 0) {
    // BigInt avoids forming the potentially unsafe Number MAX_SAFE_INTEGER + 1.
    const height = (BigInt(remaining) + 1n).toString(2).length - 2
    const perfectTreeSize = (2 ** (height + 1)) - 1

    // Two adjacent perfect trees with the same height would already have
    // produced their parent, so this is not a valid completed MMR size.
    if (height >= previousHeight) return []

    consumed += perfectTreeSize
    peaks.push(consumed)
    remaining -= perfectTreeSize
    previousHeight = height
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
  assertSafeUint(num)
  return (2 ** bitLength(num)) - 1 === num
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
  assertSafeUint(size, 'MMR size')
  if (size === 0) {
    return [0, 0]
  }
  let remaining = BigInt(size)
  let peakSize = (1n << BigInt(bitLength(size))) - 1n
  let peakMap = 0n
  while (peakSize !== 0n) {
    peakMap <<= 1n
    if (remaining >= peakSize) {
      remaining -= peakSize
      peakMap |= 1n
    }
    peakSize >>= 1n
  }
  return [Number(peakMap), Number(remaining)]
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
  assertSafeUint(num, 'node index')
  if (num === 0) throw new Error('Node index must be positive.')
  let h = num
  // Travel left until reaching leftmost branch (all bits 1)
  while (!allOnes(h)) {
    h -= (2 ** (bitLength(h) - 1)) - 1
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
  assertSafeUint(height, 'height')
  return (2 ** (height + 1)) - 1
}

/**
 * Get the offset to the next parent from `height`
 *
 * @param {number} height
 * @returns {number}
 */
export const parentOffset = height => {
  assertSafeUint(height, 'height')
  return 2 ** (height + 1)
}

/**
 * Jump to the next right sibling from `num`
 *
 * @param {number} num
 * @returns {number}
 */
/**
 * Calculates the Hamming weight (popcount) of a non-negative integer.
 * Popcount is the number of set bits (1s) in the binary representation of the number.
 * @param {number} num The integer for which to calculate the popcount.
 * @returns {number} The popcount of the number.
 */
export function popcount (num) {
  assertSafeUint(num, 'popcount input')
  let count = 0
  let tempNum = BigInt(num)
  while (tempNum > 0n) {
    tempNum &= tempNum - 1n
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
  assertSafeUint(n, 'Leaf index')

  // The core formula for calculating the MMR node index
  // This assumes the MMR's internal nodes are counted towards the total node index
  // in a compacted, left-to-right manner.
  const result = (2 * n) - popcount(n)
  if (!Number.isSafeInteger(result)) throw new Error('Leaf index produces an unsafe node index.')
  return result
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
  assertSafeUint(n, 'Number of leaves')

  // The formula: 2 * n - popcount(n)
  // n = number of leaves
  // popcount(n) = number of peaks (which is also the number of perfect trees that compose the MMR)
  const result = (2 * n) - popcount(n)
  if (!Number.isSafeInteger(result)) throw new Error('Number of leaves produces an unsafe tree size.')
  return result
}

/**
 * Return the shortest unsigned big-endian representation of an integer.
 * Zero is represented by one zero byte.
 *
 * @param {number|bigint} value
 * @returns {Uint8Array}
 */
export function uintToUint8ArrayLike (value) {
  let n
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsigned integer is out of range.')
    n = value
  } else {
    assertSafeUint(value, 'Unsigned integer')
    n = BigInt(value)
  }

  const bytes = []
  do {
    bytes.unshift(Number(n % 256n))
    n /= 256n
  } while (n > 0n)
  return Uint8Array.from(bytes)
}

export function assertSafeUint (value, name = 'Value') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`)
  }
  return value
}

export function bytesToHex (uint8aBytes) {
  return Array.from(uint8aBytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes (hexString) {
  if (typeof hexString !== 'string' || hexString.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hexString)) {
    throw new Error('invalid hex')
  }
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
