import argon2 from 'argon2';
import { isCommonPassword } from './common-passwords.js';

/** SEC-07: minimum length 12, checked against a bundled breached-password list, no composition rules, no forced rotation. */
export const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly reason: string };

export function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return {
      valid: false,
      reason: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    };
  }
  if (isCommonPassword(password)) {
    return {
      valid: false,
      reason: 'This password appears on a list of commonly breached passwords.',
    };
  }
  return { valid: true };
}

/** SEC-07: Argon2id with parameters embedded in the hash string itself, ANTI-08: never hand-rolled. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB, OWASP's current minimum recommendation for argon2id
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed/foreign hash string must fail closed, never throw past the caller.
    return false;
  }
}
