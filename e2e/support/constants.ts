/**
 * Shared between the end-to-end server and the specs it serves.
 *
 * They run in different processes, so anything both need has to be a constant
 * rather than something one hands the other.
 */

/** Dropped and recreated on every run — a leftover row is not a fixture. */
export const E2E_DATABASE = 'unifyops_e2e';

/**
 * Where the development mail transport writes what it "sent".
 *
 * The specs read it to follow an invitation link, which exists nowhere else:
 * the table stores only a SHA-256 of the token, and that is the property the
 * design is for.
 */
export const EMAIL_LOG_FILE = 'test-results/mail.jsonl';
