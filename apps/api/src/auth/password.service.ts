import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id password hashing (self-hosted auth, replaces GCIP-managed
 * credentials). `@node-rs/argon2` ships prebuilt native bindings (napi-rs), so
 * it needs no build toolchain in the Docker image, unlike the classic
 * `argon2` package which often falls back to a from-source node-gyp build.
 *
 * Explicit OWASP-baseline params rather than library defaults: 19 MiB memory,
 * 2 iterations, 1 degree of parallelism.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  // Lazily computed hash of a fixed dummy password, memoized after first use.
  // Verifying against this when a login lookup fails BEFORE reaching a real
  // user keeps response timing constant regardless of which stage failed
  // (unknown tenant slug vs unknown email vs wrong password), closing a
  // tenant/email-enumeration timing gap.
  private dummyHash?: Promise<string>;

  async hashPassword(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return verify(passwordHash, plain, ARGON2_OPTIONS);
  }

  /** Burns the same time as a real verify, without needing a real hash. */
  async verifyDummyPassword(plain: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = hash('dummy-password-for-constant-time-login', ARGON2_OPTIONS);
    }
    const dummyHash = await this.dummyHash;
    await verify(dummyHash, plain, ARGON2_OPTIONS).catch(() => false);
  }
}
