import { describe, expect, it } from 'vitest';
import { clampHistoryHeight } from './HistorySection';

describe('clampHistoryHeight', () => {
  it('keeps heights within range', () => {
    expect(clampHistoryHeight(250.4)).toBe(250);
    expect(clampHistoryHeight(10)).toBe(96);
    expect(clampHistoryHeight(5000)).toBe(900);
  });
});
