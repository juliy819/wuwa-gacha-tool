import assert from 'node:assert/strict';
import test from 'node:test';

import {
  daysSince,
  getSyncFreshness,
  SYNC_DANGER_DAYS,
  SYNC_WARN_DAYS,
} from '../src/lib/utils.ts';

const today = new Date(2026, 7, 2, 12, 0, 0);

test('daysSince uses calendar days and clamps future dates', () => {
  assert.equal(daysSince('2026-08-02 23:59:59', today), 0);
  assert.equal(daysSince('2026-08-01 00:00:00', today), 1);
  assert.equal(daysSince('2026-08-03 00:00:00', today), 0);
});

test('daysSince rejects malformed and impossible dates', () => {
  assert.equal(daysSince('', today), Infinity);
  assert.equal(daysSince('not-a-date', today), Infinity);
  assert.equal(daysSince('2026-02-31 00:00:00', today), Infinity);
});

test('freshness changes only after each configured threshold', () => {
  const dateAtDaysAgo = (days) => {
    const value = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day} 00:00:00`;
  };

  assert.equal(getSyncFreshness(dateAtDaysAgo(SYNC_WARN_DAYS), false, today), 'fresh');
  assert.equal(getSyncFreshness(dateAtDaysAgo(SYNC_WARN_DAYS + 1), false, today), 'warn');
  assert.equal(getSyncFreshness(dateAtDaysAgo(SYNC_DANGER_DAYS), false, today), 'warn');
  assert.equal(getSyncFreshness(dateAtDaysAgo(SYNC_DANGER_DAYS + 1), false, today), 'danger');
});

test('inferred timestamps do not bypass stale-data warnings', () => {
  assert.equal(getSyncFreshness('2025-01-01 00:00:00', true, today), 'danger');
});
