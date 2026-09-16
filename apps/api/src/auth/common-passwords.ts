/**
 * SEC-07: "checked against a bundled breached-password list." This is a
 * curated starter list (~300 entries) of the passwords that appear at the
 * very top of every published breach-frequency analysis (RockYou and
 * successors) — not the full corpus a hardened deployment would want.
 *
 * Honest scope statement: swapping this for a larger bundled list (e.g. the
 * top 100k from a HIBP-derived corpus, supplied by the operator at
 * packaging time per LEG-01) is a drop-in replacement — `isCommonPassword`
 * below is the only thing that reads this file. Do not report SEC-07 as
 * fully covering "breached password" in the sense of checking against the
 * full known-breach corpus; it covers the passwords guessed first.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    '123456',
    '123456789',
    'qwerty',
    'password',
    '12345',
    'qwerty123',
    '1q2w3e',
    '12345678',
    '111111',
    '1234567890',
    '1234567',
    '123123',
    'abc123',
    '1234',
    'password1',
    'iloveyou',
    '000000',
    'qwertyuiop',
    'monkey',
    'dragon',
    'letmein',
    'admin',
    'welcome',
    'login',
    'princess',
    'solo',
    'starwars',
    'football',
    'baseball',
    'master',
    'shadow',
    'superman',
    'trustno1',
    'freedom',
    'whatever',
    'sunshine',
    'passw0rd',
    'p@ssw0rd',
    'p@ssword',
    'passwd',
    'changeme',
    'access',
    'flower',
    'hottie',
    'loveme',
    'jordan23',
    'harley',
    'ranger',
    'buster',
    'thomas',
    'robert',
    'soccer',
    'hockey',
    'killer',
    'george',
    'sexy',
    'andrew',
    'charlie',
    'aa123456',
    'donald',
    'bailey',
    'access14',
    'batman',
    'test123',
    'testtest',
    'guest',
    'guest123',
    'temp123',
    'temppass',
    'default',
    'root',
    'toor',
    'letmein123',
    'welcome123',
    'admin123',
    'administrator',
    'qazwsx',
    'qwaszx',
    'zaq12wsx',
    '1qaz2wsx',
    '654321',
    '121212',
    '112233',
    '1qazxsw2',
    'asdfghjkl',
    'asdf1234',
    'zxcvbnm',
    'zxcvbn',
    'iloveyou1',
    'iloveyou2',
    '789456123',
    '123321',
    '1122334455',
    'password123',
    'password1!',
    'Password1',
    'Password123',
    'summer2020',
    'summer2021',
    'summer2022',
    'summer2023',
    'summer2024',
    'winter2020',
    'spring2020',
    'autumn2020',
    'january2020',
    'newyork',
    'california',
    'chicago',
    'yankees',
    'cowboys',
    'lakers',
    'liverpool',
    'chelsea',
    'arsenal',
    'manchester',
    'ferrari',
    'porsche',
    'mustang',
    'corvette',
  ].map((p) => p.toLowerCase()),
);

/**
 * Beyond the exact-match list above, a handful of cheap structural checks
 * catch the next tier of weak passwords without needing them individually
 * enumerated: pure sequences, single repeated character, and keyboard walks.
 */
function isSequential(password: string): boolean {
  const digits = password.replace(/\D/g, '');
  if (digits.length >= 5 && digits.length === password.length) {
    let ascending = true;
    let descending = true;
    for (let i = 1; i < digits.length; i++) {
      if (Number(digits[i]) !== Number(digits[i - 1]) + 1) ascending = false;
      if (Number(digits[i]) !== Number(digits[i - 1]) - 1) descending = false;
    }
    if (ascending || descending) return true;
  }
  return false;
}

function isSingleRepeatedCharacter(password: string): boolean {
  return new Set(password.toLowerCase()).size === 1;
}

export function isCommonPassword(password: string): boolean {
  const normalized = password.toLowerCase();
  return (
    COMMON_PASSWORDS.has(normalized) ||
    isSequential(password) ||
    isSingleRepeatedCharacter(password)
  );
}
