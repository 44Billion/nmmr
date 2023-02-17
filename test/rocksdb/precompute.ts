import assert from 'assert';
import { RocksDBMMR as MMR } from '../../src';

describe('Merkle tmp precomputation', () => {
    let mmr: MMR;

    before(async () => {
        mmr = new MMR({
            withRootHash: true,
            location: './rocksdb-db',
        });
        await mmr.init(true);

        const leaves = 100;
        for (let i = 1; i <= leaves; i++) {
            await mmr.append(i.toString());
        }
    });

    it('should correctly precompute future elements and generate/verify future proofs', async () => {
        const lastPosBefore = await mmr.dbGet('lastPos');
        const peaksBefore = await mmr.retrievePeaksHashes();

        const computationUuid = '123456';
        await mmr.precomputeInit(computationUuid);
        for (let idx = 1; idx < 100; ++idx) {
            const { leafIdx, lastPos } = await mmr.precomputeAppend(
                computationUuid,
                idx.toString()
            );
            const futureProof = await mmr.precomputeGetProof(
                computationUuid,
                Number(leafIdx),
                lastPos
            );
            await mmr.precomputeVerifyProof(computationUuid, futureProof);
            await mmr.precomputeRetrievePeaksHashes(computationUuid);
        }
        await mmr.precomputeReset(computationUuid);

        // Should not have altered the MMR tree.
        const lastPosAfter = await mmr.dbGet('lastPos');
        const peaksAfter = await mmr.retrievePeaksHashes();

        assert.strictEqual(lastPosBefore, lastPosAfter);
        assert.deepStrictEqual(peaksBefore, peaksAfter);
    });

    afterEach(async () => mmr.disconnectDb());
});
