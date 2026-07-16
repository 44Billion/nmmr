import assert from 'node:assert/strict'
import MMR from '../../src/mmrs/ram/index.js'
import NMMR from '../../src/lib/nmmr.js'
import { uintToUint8ArrayLike } from '../../src/lib/helpers.js'

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

it('invalidates a previously calculated root when another leaf is appended', async () => {
  const nmmr = new NMMR()
  await nmmr.append(Uint8Array.of(1))
  const firstRoot = nmmr.getRoot()
  await nmmr.append(Uint8Array.of(2))
  assert.notEqual(nmmr.getRoot(), firstRoot)
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
    assert.deepEqual(Object.keys(chunk), ['contentBytes', 'index', 'total', 'proof'])
    assert.equal(NMMR.verifyProof({ ...chunk, root: nmmr.getRoot() }), true)
    assert.equal(chunk.proof.length % 32, 0)
  }
})

it('verifies every peak position in non-perfect MMRs', async () => {
  const t = new TextEncoder()
  for (let total = 1; total <= 31; total++) {
    const nmmr = new NMMR()
    for (let index = 0; index < total; index++) await nmmr.append(t.encode(`leaf-${total}-${index}`))
    const expectedRoot = nmmr.getRoot()
    let seen = 0
    for await (const chunk of nmmr.getChunks()) {
      assert.equal(NMMR.calculateRoot(chunk), expectedRoot)
      assert.equal(NMMR.verifyProof({ ...chunk, root: expectedRoot }), true)
      seen++
    }
    assert.equal(seen, total)
  }
})

it('binds proofs to content, index, total and exact proof bytes', async () => {
  const t = new TextEncoder()
  const nmmr = new NMMR()
  for (const value of ['a', 'b', 'c', 'd', 'e']) await nmmr.append(t.encode(value))
  const chunks = []
  for await (const chunk of nmmr.getChunks()) chunks.push(chunk)
  const chunk = chunks[4]

  const root = nmmr.getRoot()
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, contentBytes: t.encode('changed') }), /Root hash mismatch/)
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, index: 3 }), /proof length|Root hash mismatch/i)
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, total: 6 }), /proof length|Root hash mismatch/i)
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, proof: new Uint8Array(0) }), /proof length/i)
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, proof: new Uint8Array(64) }), /proof length/i)
  assert.throws(() => NMMR.verifyProof({ ...chunk, root, index: '04' }), /canonical unsigned integer/i)
})

it('has stable v2 vectors', async () => {
  const t = new TextEncoder()
  const nmmr = new NMMR()
  for (const value of ['a', 'b', 'c', 'd', 'e']) await nmmr.append(t.encode(value))
  assert.equal(nmmr.getRoot(), 'ccaa8a762a6163304c758929218f7243c3603401d3c9185057a82af2ca2074cb')

  const chunks = []
  for await (const chunk of nmmr.getChunks()) chunks.push(chunk)
  assert.equal(NMMR.deriveChunkId(nmmr.getRoot(), 0), '42048a5b6b50abbb90cef8bfc18917640642eb85b96fb66261a7d1bbb55ecbdd')
  assert.equal(NMMR.deriveChunkId(nmmr.getRoot(), 4), 'e7664c3551bf121e3f811381fae90396a869fce2add30b3ca48024ea67ff689b')
  assert.equal(chunks[0].proof.length, 96)
  assert.equal(chunks[4].proof.length, 32)
})

it('encodes unsigned integers without 32-bit truncation', () => {
  assert.deepEqual([...uintToUint8ArrayLike(0)], [0])
  assert.deepEqual([...uintToUint8ArrayLike(256)], [1, 0])
  assert.deepEqual([...uintToUint8ArrayLike(2 ** 31)], [128, 0, 0, 0])
  assert.deepEqual(
    [...uintToUint8ArrayLike(Number.MAX_SAFE_INTEGER)],
    [31, 255, 255, 255, 255, 255, 255]
  )
  assert.throws(() => uintToUint8ArrayLike(Number.MAX_SAFE_INTEGER + 1), /safe integer|out of range/i)
  assert.throws(
    () => MMR.getProofLayout(Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1, Math.floor(Number.MAX_SAFE_INTEGER / 2) + 2),
    /unsafe/i
  )

  const root = '00'.repeat(32)
  assert.match(NMMR.deriveChunkId(root, 2 ** 31), /^[0-9a-f]{64}$/)
  assert.notEqual(NMMR.deriveChunkId(root, 2 ** 31), NMMR.deriveChunkId(root, 0))
  assert.ok(MMR.getProofLayout(2 ** 31, (2 ** 31) + 1).nodeIndex > 2 ** 31)
})
