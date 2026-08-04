const test = require('node:test');
const assert = require('node:assert/strict');

const walletConstants = require('../src/config/wallet.constants');
walletConstants.getWalletLimits = async () => ({
  CAPTAIN_MIN_BALANCE: -300,
  CAPTAIN_MAX_BALANCE: 1500,
  CAPTAIN_MIN_TOPUP: 10,
});
walletConstants.getCaptainWallet = async () => null;

const walletService = require('../src/services/wallet.service');

test('rejects top-up below the configured minimum with the new message', async () => {
  await assert.rejects(
    () => walletService.validateTopUp('user-1', 9),
    /أقل مبلغ للشحن هو 10 ج\.م/
  );
});

test('allows a top-up at the minimum amount', async () => {
  const result = await walletService.validateTopUp('user-1', 10);
  assert.equal(result.parsedAmount, 10);
  assert.equal(result.newBalance, 10);
});
