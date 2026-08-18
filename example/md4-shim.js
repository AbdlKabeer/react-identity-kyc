const crypto = require('crypto')

const originalCreateHash = crypto.createHash
crypto.createHash = function createHash(algorithm) {
  const safeAlgorithm = algorithm === 'md4' ? 'sha256' : algorithm
  return originalCreateHash.call(this, safeAlgorithm)
}
