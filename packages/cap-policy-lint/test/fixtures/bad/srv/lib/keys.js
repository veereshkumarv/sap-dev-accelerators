/**
 * What: Fixture: source file containing a (fake, truncated) private key block.
 * Why: Positive fixture for raw secret-pattern detection in any text file.
 * If missing or unlinked: The private-key detection test fails and that detector is no longer
 *     proven.
 */
module.exports = {
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----',
};
