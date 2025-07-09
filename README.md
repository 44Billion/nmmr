This is a [fork](https://github.com/HerodotusDev/merkle-mountain-ranges) from Herodotus Dev Ltd's merkle-mountain-ranges npm package
altered to fit Nostr protocol ecosystem

### Installing the package

```sh
$> npm i nostr-mmr
```

### Using the Merkle Mountaing Range

```js
import MMR from 'nostr-mmr'

const mmr = new Mmr()
const leaves = 11 // Total node size will be 19
for (let idx = 0; idx < leaves; ++idx) {
  await mmr.append((idx + 1).toString()) // Leaf number starts at 1 in this implementation.
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

// Generating a proof for leaf no.9 (16th node in the inclusion diagram above)
const proof = mmr.getProof(9)
console.log('Inclusion proof of leaf no.9', proof)
// Verifying the proof (throws on failure, pass on success)
mmr.verifyProof(proof)
console.log('Valid proof!')
// Inclusion proof of leaf no.9 {
//   index: 9,
//   value: '6',
//   peaks: [ 15, 18, 19 ],
//   peaksHashes: [
//     '0x7811cf3bd6a5f019f9c345900f760694309d019be0766007388665145c431b3',
//     '0x5ad94a9ad7f469929d8e513ddb87e8758bddc928b06dede8c9e248630ed48f9',
//     '0x197f42d06f2cf19f82d475673f16350416f2c9180d77bea8a3bcc29d27b7325'
//   ],
//   siblingHashes: [
//     '0x3531a94afdc03b1ee109786fdddaf23a7864c8f18ddff9d552b5dfb50ac66a',
//     '0x41132c938a98be60612de7aed9daa905f91c8390f731c7fde8fb8bd59bbe4c3',
//     '0x4a1fead9ecdd90793ba10b7da6e8a30d655843296f148f147a89cb3e978528'
//   ],
//   lastVisitedNodeIdx: 15
// }
// Valid proof!
```

## License

[GNU GPLv3](https://github.com/HerodotusDev/merkle-mountain-ranges/blob/main/LICENSE)
