const test = require('node:test');
const assert = require('node:assert/strict');
const { buildKashierWebhookUrl } = require('../src/services/kashier');

test('builds the webhook URL under the wallet route', () => {
  assert.equal(
    buildKashierWebhookUrl('https://example.com'),
    'https://example.com/api/v1/wallet/kashier-webhook'
  );
});
