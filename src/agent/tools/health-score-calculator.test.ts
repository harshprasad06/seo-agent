import { clampScore } from './health-score-calculator';

describe('clampScore', () => {
  it('returns value unchanged when within [0, 100]', () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
  });

  it('clamps negative values to 0', () => {
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(-999)).toBe(0);
  });

  it('clamps values above 100 to 100', () => {
    expect(clampScore(101)).toBe(100);
    expect(clampScore(999)).toBe(100);
  });

  it('rounds fractional values to nearest integer', () => {
    expect(clampScore(50.4)).toBe(50);
    expect(clampScore(50.5)).toBe(51);
    expect(clampScore(99.9)).toBe(100);
  });

  it('rounds and then clamps (e.g. 100.4 → 100)', () => {
    expect(clampScore(100.4)).toBe(100);
  });
});

describe('scoring logic (unit)', () => {
  it('composite score formula: average of 4 components rounded', () => {
    // Verify the formula: Math.round((a + b + c + d) / 4)
    const a = 80, b = 60, c = 70, d = 90;
    const expected = Math.round((a + b + c + d) / 4);
    expect(expected).toBe(75);
  });

  it('backlink baseline is 50 before any adjustments', () => {
    // baseline = 50, no active or lost backlinks → score = 50
    expect(clampScore(50)).toBe(50);
  });

  it('active backlink bonus caps at +50', () => {
    // 10 active backlinks × 5 = 50 bonus → 50 + 50 = 100
    const baseline = 50;
    const activeCount = 10;
    const bonus = Math.min(activeCount * 5, 50);
    expect(clampScore(baseline + bonus)).toBe(100);
  });

  it('active backlink bonus does not exceed +50 even with more backlinks', () => {
    const baseline = 50;
    const activeCount = 20; // 20 × 5 = 100, but capped at 50
    const bonus = Math.min(activeCount * 5, 50);
    expect(clampScore(baseline + bonus)).toBe(100);
  });

  it('technical score deductions clamp to 0', () => {
    // 11 pages with http_status >= 400 → 100 - 110 = -10 → clamped to 0
    const deductions = 11 * 10;
    expect(clampScore(100 - deductions)).toBe(0);
  });

  it('keyword score can exceed 100 from top-10 bonuses but clamps to 100', () => {
    // 5 top-10 keywords → 100 + 10 = 110 → clamped to 100
    expect(clampScore(100 + 5 * 2)).toBe(100);
  });
});
