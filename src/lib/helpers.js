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
