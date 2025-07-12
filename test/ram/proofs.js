import assert from 'node:assert'
import { MMR } from '../../src/mmrs/ram/index.js'
import { pedersen } from '../../src/pkg/pedersen_wasm.js'

const testFns = {
  toLeafNode: (data, mmrSize) => pedersen(mmrSize.toString(), data),
  toParentNode: (leftChild, rightChild, mmrSize) => pedersen(mmrSize.toString(), pedersen(leftChild, rightChild)),
  toRootNode: (bag, mmrSize) => pedersen(mmrSize.toString(), bag),
  concatPeaks: (accRightPeaks, leftPeak) => pedersen(accRightPeaks, leftPeak)
}

describe('Merkle proofs generations and verifications', () => {
  let mmr

  before(async () => {
    mmr = new MMR(testFns, { isDebugging: true })
    const leaves = 11
    for (let i = 1; i <= leaves; i++) {
      await mmr.append(i.toString())
    }
    /*
 Height
    3              15
                /     \
               /       \
              /         \
             /           \
    2       7            14
          /    \       /    \
    1    3     6     10     13     18
        / \   / \    / \   /  \   /  \
    0  1   2 4   5  8   9 11  12 16  17 19
    */
  })

  it('should generate valid proofs', async () => {
    let proof

    // First peak
    proof = await mmr.getProof(1)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(2)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(4)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(5)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(8)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(9)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(11)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(12)
    assert.equal(proof.lastVisitedNodeIdx, 15)
    assert.equal(proof.siblingHashes.length, 3)
    await mmr.verifyProof(proof)

    // Second peak
    proof = await mmr.getProof(16)
    assert.equal(proof.lastVisitedNodeIdx, 18)
    assert.equal(proof.siblingHashes.length, 1)
    await mmr.verifyProof(proof)

    proof = await mmr.getProof(17)
    assert.equal(proof.lastVisitedNodeIdx, 18)
    assert.equal(proof.siblingHashes.length, 1)
    await mmr.verifyProof(proof)

    // Third peak (which is also a leaf)
    proof = await mmr.getProof(19)
    assert.equal(proof.lastVisitedNodeIdx, 19)
    assert.equal(proof.siblingHashes.length, 0)
    await mmr.verifyProof(proof)
  })
})
