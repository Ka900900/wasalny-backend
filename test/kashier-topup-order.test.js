const test = require('node:test');
const assert = require('node:assert/strict');

const { isTopupOrderId, extractTopupUserId } = require('../src/services/kashier');

test('recognizes topup order IDs case-insensitively', () => {
  assert.equal(isTopupOrderId('TOPUP_user_123'), true);
  assert.equal(isTopupOrderId('topup_user_123'), true);
  assert.equal(extractTopupUserId('TOPUP_user_123'), 'user');
});

test('returns null for non-topup order IDs', () => {
  assert.equal(isTopupOrderId('ride_123'), false);
  assert.equal(extractTopupUserId('ride_123'), null);
});
