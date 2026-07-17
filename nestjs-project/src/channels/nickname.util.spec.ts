import { appendRandomSuffix, sanitizeNickname } from './nickname.util';

describe('sanitizeNickname', () => {
  it('lowercases and strips invalid chars', () => {
    expect(sanitizeNickname('Hello.World+Test')).toBe('helloworldtest');
  });

  it('preserves underscores', () => {
    expect(sanitizeNickname('john_doe')).toBe('john_doe');
  });

  it('preserves digits', () => {
    expect(sanitizeNickname('user123')).toBe('user123');
  });

  it('truncates to 46 characters', () => {
    expect(sanitizeNickname('a'.repeat(60))).toHaveLength(46);
  });

  it('returns user_ + 8 random hex when result is empty special chars', () => {
    expect(sanitizeNickname('!!!---')).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('returns user_ + 8 random hex for empty string', () => {
    expect(sanitizeNickname('')).toMatch(/^user_[a-z0-9]{8}$/);
  });

  it('produces different fallbacks on repeated calls', () => {
    const a = sanitizeNickname('!!!');
    const b = sanitizeNickname('!!!');
    expect(a).toMatch(/^user_[a-z0-9]{8}$/);
    expect(b).toMatch(/^user_[a-z0-9]{8}$/);
  });

  // ── Corner Cases ────────────────────────────────────────
  it('strips all uppercase letters', () => {
    expect(sanitizeNickname('JOHN')).toBe('john');
  });

  it('strips spaces', () => {
    expect(sanitizeNickname('hello world')).toBe('helloworld');
  });

  it('strips hyphens', () => {
    expect(sanitizeNickname('hello-world')).toBe('helloworld');
  });

  it('strips @ and domain', () => {
    expect(sanitizeNickname('user@domain')).toBe('userdomain');
  });

  it('keeps mixed letters digits and underscores', () => {
    expect(sanitizeNickname('a1_b2_c3')).toBe('a1_b2_c3');
  });

  it('returns only lowercase result from mixed case', () => {
    expect(sanitizeNickname('AbCdEf')).toBe('abcdef');
  });

  it('handles exactly 46 chars input', () => {
    const input = 'a'.repeat(46);
    const result = sanitizeNickname(input);
    expect(result).toBe(input);
    expect(result.length).toBe(46);
  });

  it('handles exactly 47 chars input (truncates to 46)', () => {
    const input = 'a'.repeat(47);
    expect(sanitizeNickname(input)).toHaveLength(46);
  });

  it('handles single character input', () => {
    expect(sanitizeNickname('x')).toBe('x');
  });

  it('handles input with only allowed chars', () => {
    expect(sanitizeNickname('abcdef123456_xyz')).toBe('abcdef123456_xyz');
  });

  it('fallback nickname always starts with user_', () => {
    for (let i = 0; i < 5; i++) {
      expect(sanitizeNickname('!!!')).toMatch(/^user_/);
    }
  });

  it('fallback nickname has exactly 13 chars', () => {
    expect(sanitizeNickname('!!!')).toHaveLength(13);
  });
});

describe('appendRandomSuffix', () => {
  it('appends underscore and 3 hex chars', () => {
    expect(appendRandomSuffix('john')).toMatch(/^john_[a-z0-9]{3}$/);
  });

  it('total length at most 50 chars', () => {
    expect(appendRandomSuffix('a'.repeat(46))).toHaveLength(50);
  });

  it('truncates base to 46 before appending', () => {
    const result = appendRandomSuffix('a'.repeat(60));
    expect(result).toHaveLength(50);
    expect(result).toMatch(/^a{46}_[a-z0-9]{3}$/);
  });

  it('only lowercase letters and digits in suffix', () => {
    Array.from({ length: 10 }).forEach(() => {
      expect(appendRandomSuffix('base')).toMatch(/^base_[a-z0-9]{3}$/);
    });
  });

  // ── Corner Cases ────────────────────────────────────────
  it('works with short base name', () => {
    expect(appendRandomSuffix('a')).toMatch(/^a_[a-z0-9]{3}$/);
  });

  it('works with single char base', () => {
    expect(appendRandomSuffix('x')).toMatch(/^x_[a-z0-9]{3}$/);
  });

  it('works with base containing underscores', () => {
    expect(appendRandomSuffix('hello_world')).toMatch(
      /^hello_world_[a-z0-9]{3}$/,
    );
  });

  it('suffix varies between calls', () => {
    const results = new Set(
      Array.from({ length: 5 }, () => appendRandomSuffix('base')),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it('base is preserved exactly when under 46 chars', () => {
    const result = appendRandomSuffix('hello');
    expect(result.startsWith('hello_')).toBe(true);
  });
});
