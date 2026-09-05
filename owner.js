const { createHash } = require('node:crypto');

// Fingerprint of the main owner's verified LINE user ID. Never match display names.
const OWNER_FINGERPRINT = 'efa92374c1fb8aea8265a8368dfb124ea625604502f4dc49a42a3790ed966f44';

function isMainOwner(userId) {
  return typeof userId === 'string' &&
    createHash('sha256').update(userId).digest('hex') === OWNER_FINGERPRINT;
}

module.exports = { isMainOwner };
