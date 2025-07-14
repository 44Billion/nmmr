import assert from 'node:assert/strict'
import MMR from '../../src/mmrs/ram/index.js'
import NMMR from '../../src/lib/nmmr.js'

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

// It needs the sibling hashes.
// It doesn't need the peak hash when it is the same as the leaf hash (1st leaf, 3rd, 5th...)
// It doesn't need peak hashes that can be calculated from the leaf hash and their sibling hashes
it('has shortest proof', async () => {
  const t = new TextEncoder()
  const nmmr = new NMMR()
  await nmmr.append(t.encode('a'))
  await nmmr.append(t.encode('b'))
  await nmmr.append(t.encode('c'))
  await nmmr.append(t.encode('c'))
  await nmmr.append(t.encode('d'))
  await nmmr.append(t.encode('e'))
  await nmmr.append(t.encode('f'))
  await nmmr.append(t.encode('g'))
  for await (const chunk of nmmr.getChunks()) {
    assert.doesNotThrow(() => NMMR.verifyProof(chunk))
  }
})
