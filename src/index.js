import NMMR from './lib/nmmr.js'
import { MMR as InMemoryMMR } from './mmrs/ram/index.js'
import { uintToUint8ArrayLike } from './lib/helpers.js'

export { InMemoryMMR, uintToUint8ArrayLike }
export default NMMR
