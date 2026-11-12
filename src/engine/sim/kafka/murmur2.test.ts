import { describe, expect, it } from 'vitest';
import { murmur2String, toPositive } from './murmur2';

describe('murmur2', () => {
  it('[murmur2-vectors] matches the vectors of the Kafka client tests', () => {
    expect(murmur2String('21')).toBe(-973932308);
    expect(murmur2String('foobar')).toBe(-790332482);
    expect(murmur2String('a-little-bit-long-string')).toBe(-985981536);
    expect(murmur2String('a-little-bit-longer-string')).toBe(-1486304829);
    expect(murmur2String('abc')).toBe(479470107);
  });

  it('[murmur2-vectors] toPositive is a mask, not abs', () => {
    expect(murmur2String('user-2')).toBe(-324981792);
    expect(toPositive(-324981792)).toBe(1822501856);
    expect(murmur2String('a')).toBe(-1563381124);
    expect(toPositive(-1563381124)).toBe(584102524);
  });

  it('[murmur2-vectors] more computed vectors of the notes', () => {
    expect(murmur2String('user-1')).toBe(1404122828);
    expect(murmur2String('order-42')).toBe(501153024);
    expect(murmur2String('hello')).toBe(2132663229);
    expect(murmur2String('key1')).toBe(28543940);
    expect(murmur2String('')).toBe(275646681);
  });
});
