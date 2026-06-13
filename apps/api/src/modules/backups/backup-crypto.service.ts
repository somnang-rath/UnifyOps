import { BadRequestException, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

const ALGORITHM   = 'aes-256-gcm';
const KEY_LEN     = 32; // bytes  → 256-bit key
const IV_LEN      = 16; // bytes
const SALT_LEN    = 32; // bytes
const AUTH_TAG_LEN = 16; // bytes
const PBKDF2_ITER = 100_000;
const PBKDF2_HASH = 'sha256';

export interface EncryptedEnvelope {
  iv:   string; // hex
  salt: string; // hex
  /** base64-encoded ciphertext + 16-byte GCM auth-tag appended */
  ciphertext: string;
}

@Injectable()
export class BackupCryptoService {
  /** Encrypt a gzip-compressed backup buffer with a user-supplied password. */
  encrypt(plaintext: Buffer, password: string): EncryptedEnvelope {
    const salt = randomBytes(SALT_LEN);
    const iv   = randomBytes(IV_LEN);
    const key  = pbkdf2Sync(password, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_HASH);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LEN });
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag   = cipher.getAuthTag();

    return {
      iv:         iv.toString('hex'),
      salt:       salt.toString('hex'),
      ciphertext: Buffer.concat([encrypted, authTag]).toString('base64'),
    };
  }

  /** Decrypt and return the original buffer, or throw BadRequestException on wrong password. */
  decrypt(envelope: EncryptedEnvelope, password: string): Buffer {
    const salt     = Buffer.from(envelope.salt, 'hex');
    const iv       = Buffer.from(envelope.iv, 'hex');
    const raw      = Buffer.from(envelope.ciphertext, 'base64');
    const authTag  = raw.subarray(raw.length - AUTH_TAG_LEN);
    const ciphered = raw.subarray(0, raw.length - AUTH_TAG_LEN);
    const key      = pbkdf2Sync(password, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_HASH);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LEN });
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphered), decipher.final()]);
    } catch {
      throw new BadRequestException('Invalid backup password');
    }
  }
}
