import { isRefreshCandidate } from './content-refresh-tracker';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('isRefreshCandidate', () => {
  it('returns true when page is 90+ days old and position > 20', () => {
    expect(isRefreshCandidate(daysAgo(90), 21)).toBe(true);
    expect(isRefreshCandidate(daysAgo(180), 50)).toBe(true);
  });

  it('returns true when page is 90+ days old and position is null (unranked)', () => {
    expect(isRefreshCandidate(daysAgo(90), null)).toBe(true);
  });

  it('returns false when page is less than 90 days old', () => {
    expect(isRefreshCandidate(daysAgo(89), null)).toBe(false);
    expect(isRefreshCandidate(daysAgo(0), 50)).toBe(false);
  });

  it('returns false when position is 20 or better, even if old enough', () => {
    expect(isRefreshCandidate(daysAgo(100), 20)).toBe(false);
    expect(isRefreshCandidate(daysAgo(100), 1)).toBe(false);
  });

  it('returns false when both conditions fail', () => {
    expect(isRefreshCandidate(daysAgo(10), 5)).toBe(false);
  });
});
