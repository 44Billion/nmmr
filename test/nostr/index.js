import assert from 'node:assert/strict'
import MMR from '../../src/mmrs/ram/index.js'

const noPrefixFns = {
  toLeafNode (data, mmrSize) { return data },
  toParentNode (leftChild, rightChild, mmrSize) { return leftChild + rightChild },
  toRootNode (bag, mmrSize) { return bag },
  concatPeaks (accRightPeaks, leftPeak) { return leftPeak + accRightPeaks }
}

it('returns peaks in the right order', () => {
  const mmr = new MMR(noPrefixFns, { isDebugging: true })
  mmr.append('a')
  mmr.append('b')
  let { leafIdx, intLeafIdx = parseInt(leafIdx) } = mmr.append('c')
  assert.deepEqual(mmr.getProof(intLeafIdx).peaksHashes, ['ab', 'c'])
  mmr.append('d')
  ;({ leafIdx, intLeafIdx = parseInt(leafIdx) } = mmr.append('e'))
  assert.deepEqual(mmr.getProof(intLeafIdx).peaksHashes, ['abcd', 'e'])
})

it('produces correct hashes', () => {
  //       abcde
  //     abcd
  //   ab     cd
  // a  b    c  d    e
  const mmr = new MMR(noPrefixFns, { isDebugging: true })
  mmr.append('a')
  mmr.append('b')
  mmr.append('c')
  mmr.append('d')
  mmr.append('e')
  assert.deepEqual([...Object.values(mmr.hashes), mmr.bagThePeaks()], ['a', 'b', 'ab', 'c', 'd', 'cd', 'abcd', 'e', 'abcde'])
})

it('works with binary data', () => {
  const t = new TextEncoder()
  const mmr = new MMR(noPrefixFns, { isDebugging: true })
  mmr.append(t.encode('a'))
  const currentProof = mmr.getProof(parseInt(mmr.append(t.encode('b')).leafIdx))
  assert.doesNotThrow(() => mmr.verifyProof(currentProof))
  assert.doesNotThrow(() => mmr.bagThePeaks())
})
