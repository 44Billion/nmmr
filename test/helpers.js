import assert from 'node:assert'
import { findPeaks, getHeight } from '../src/lib/helpers.js'
import hSample from './samples/heights.json' with { type: 'json' }
import pSample from './samples/peaks.json' with { type: 'json' }

describe('getHeight', () => {
  it('should return correct heights', () => {
    for (let idx = 1; idx < hSample.heights.length; ++idx) {
      assert.strictEqual(getHeight(idx), hSample.heights[idx - 1]);
    }
  })
})

describe('findPeaks', () => {
  it('should return correct peaks', () => {
    for (let idx = 0; idx < pSample.peaks.length; ++idx) {
      assert.deepStrictEqual(findPeaks(idx), pSample.peaks[idx]);
    }
  })
})
