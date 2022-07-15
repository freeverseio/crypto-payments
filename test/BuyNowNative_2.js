/* eslint-disable max-len */
/* eslint-disable no-undef */

const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBuyNow, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const {
  fromHexString, toBN, provideFunds, registerAccountInLocalTestnet, getGasFee, assertBalances,
} = require('../helpers/utils');
const { TimeTravel } = require('../helpers/TimeTravel');

require('chai')
  .use(require('chai-as-promised'))
  .should();

const EIP712Verifier = artifacts.require('EIP712VerifierBuyNow');
const BuyNowNative = artifacts.require('BuyNowNative');

contract('BuyNowNative2', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const [deployer, alice, bob, carol] = accounts;
  const feesCollector = carol;
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const operator = operatorAccount.address;
  const dummySignature = '0x009a76c8f1c6f4286eb295ddc60d1fbe306880cbc5d36178c67e97d4993d6bfc112c56ff9b4d988af904cd107cdcc61f11461d6a436e986b665bb88e1b6d32c81c';
  const defaultAmount = 300;
  const defaultFeeBPS = 500; // 5%
  const now = Math.floor(Date.now() / 1000);
  const timeToPay = 30 * 24 * 3600; // one month
  const deadline = now + timeToPay;
  const paymentData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    amount: defaultAmount.toString(),
    feeBPS: defaultFeeBPS,
    universeId: '1',
    deadline,
    buyer: buyerAccount.address,
    seller: alice,
  };
  const [NOT_STARTED, ASSET_TRANSFERRING, REFUNDED, PAID] = [0, 1, 2, 3];
  const initialBuyerETH = 1000000000000000000;
  const initialOperatorETH = 6000000000000000000;
  const timeTravel = new TimeTravel(web3);

  let eip712;
  let payments;
  let snapshot;

  beforeEach(async () => {
    snapshot = await timeTravel.takeSnapshot();
    eip712 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;
    payments = await BuyNowNative.new(CURRENCY_DESCRIPTOR, eip712.address).should.be.fulfilled;
    await registerAccountInLocalTestnet(buyerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(operatorAccount).should.be.fulfilled;
    await provideFunds(deployer, operator, initialOperatorETH);
    await payments.setUniverseOperator(
      paymentData.universeId,
      operator,
    ).should.be.fulfilled;
    await payments.setUniverseFeesCollector(
      paymentData.universeId,
      feesCollector,
    ).should.be.fulfilled;
  });

  afterEach(async () => {
    await timeTravel.revertToSnapShot(snapshot.result);
  });

  async function buildFinalizeSignature(_paymentId, _success, _operatorPvk) {
    const data = { paymentId: _paymentId, wasSuccessful: _success };
    const signature = await ethSigUtil.signTypedMessage(
      fromHexString(_operatorPvk.slice(2)),
      prepareDataToSignAssetTransfer({
        msg: data,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );
    return { signature, data };
  }

  async function finalize(_paymentId, _success, _operatorPvk) {
    const { signature, data } = await buildFinalizeSignature(_paymentId, _success, _operatorPvk);
    await payments.finalize(data, signature);
  }

  async function finalizeAndWithdraw(_paymentId, _success, _operatorPvk, fromAddress) {
    const { signature, data } = await buildFinalizeSignature(_paymentId, _success, _operatorPvk);
    const receipt = await payments.finalizeAndWithdraw(data, signature, { from: fromAddress });
    return getGasFee(receipt);
  }

  // Executes a Payment. Reused by many tests.
  // It first funds the buyer, then buyer approves, signs, and the operator relays the payment.
  async function buyNow(_paymentData, _ETHSupplyForBuyer, _txAmount) {
    await provideFunds(deployer, buyerAccount.address, _ETHSupplyForBuyer);

    // Operator signs purchase
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBuyNow({
        msg: _paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    // Pay
    const value = _txAmount >= 0 ? _txAmount : _paymentData.amount;
    const receipt = await payments.buyNow(_paymentData, signature, { from: _paymentData.buyer, value });
    const gasFee = getGasFee(receipt);
    return { signature, gasFee };
  }

  async function assertBalances(_contract, addresses, amounts) {
    for (let i = 0; i < addresses.length; i += 1) {
      if (_contract === 'native') {
        // eslint-disable-next-line no-await-in-loop
        assert.equal(String(await web3.eth.getBalance(addresses[i])), String(amounts[i]));
      } else {
        // eslint-disable-next-line no-await-in-loop
        assert.equal(String(await _contract.balanceOf(addresses[i])), String(amounts[i]));
      }
    }
  }

  it('From PAID: seller can withdraw, all balances work as expected', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));
    const expectedNativeOperator = toBN(await web3.eth.getBalance(operator));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from native coin balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the external balance
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    expectedPaymentsSeller = toBN(sellerAmount);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the funds have gone from buyer to seller, external to this contract
    let receipt = await payments.withdraw({ from: paymentData.seller }).should.be.fulfilled;
    let fee = getGasFee(receipt);

    expectedPaymentsSeller = toBN(0);
    expectedNativeSeller.iadd(toBN(sellerAmount - fee));

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the external balance
    receipt = await payments.withdraw({ from: feesCollector }).should.be.fulfilled;
    fee = getGasFee(receipt);

    expectedPaymentsFeesCollector = toBN(0);
    expectedNativeFeesCollector.iadd(toBN(feeAmount - fee));

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('From PAID: seller can withdraw, all balances work as expected (finalize => finalizeAndWithdraw)', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));
    const expectedNativeOperator = toBN(await web3.eth.getBalance(operator));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from native coin balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the external balance
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals
    const withdrawFee = await finalizeAndWithdraw(paymentData.paymentId, true, operatorPrivKey, paymentData.seller);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    expectedNativeSeller.iadd(toBN(sellerAmount)).isub(withdrawFee);
    expectedPaymentsSeller = toBN(0);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the funds have gone from buyer to seller, external to this contract
    await truffleAssert.reverts(
      payments.withdraw({ from: paymentData.seller }),
      'cannot withdraw zero amount.',
    );
  });

  it('From PAID: seller can withdraw, all balances work as expected (finalize => finalizeAndWithdrawTo)', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));
    const expectedNativeOperator = toBN(await web3.eth.getBalance(operator));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from native coin balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the external balance
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals

    // First the seller retains the sole right to execute his/her withdrawals:
    let receiptSetOnlyUser = await payments.setOnlyUserCanWithdraw(true, { from: paymentData.seller }).should.be.fulfilled;
    const feeSetOnlyUser = getGasFee(receiptSetOnlyUser);

    truffleAssert.reverts(
      finalizeAndWithdraw(paymentData.paymentId, true, operatorPrivKey, deployer),
      'tx sender not authorized to withdraw on recipients behalf',
    );

    // Then the seller authorizes 3rd parties:
    receiptSetOnlyUser = await payments.setOnlyUserCanWithdraw(false, { from: paymentData.seller }).should.be.fulfilled;
    feeSetOnlyUser.iadd(getGasFee(receiptSetOnlyUser));

    await finalizeAndWithdraw(paymentData.paymentId, true, operatorPrivKey, deployer);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - Number(feeAmount) - Number(feeSetOnlyUser);

    expectedNativeSeller.iadd(toBN(sellerAmount));
    expectedPaymentsSeller = toBN(0);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the funds have gone from buyer to seller, external to this contract
    await truffleAssert.reverts(
      payments.withdraw({ from: paymentData.seller }),
      'cannot withdraw zero amount.',
    );
  });

  it('withdraws can be done on behalf of user (like previous test but withdraw -> relayedWithdraw)', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));
    const expectedNativeOperator = toBN(await web3.eth.getBalance(operator));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from native coin balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the external balance
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    expectedPaymentsSeller = toBN(sellerAmount);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the funds have gone from buyer to seller, external to this contract

    // First the seller retains the sole right to execute his/her withdrawals:
    let receiptSetOnlyUser = await payments.setOnlyUserCanWithdraw(true, { from: paymentData.seller }).should.be.fulfilled;
    const feeSetOnlyUser = getGasFee(receiptSetOnlyUser);

    await truffleAssert.reverts(
      payments.relayedWithdraw(paymentData.seller),
      'tx sender not authorized to withdraw on recipients behalf',
    );

    // Then the seller authorizes 3rd parties:
    receiptSetOnlyUser = await payments.setOnlyUserCanWithdraw(false, { from: paymentData.seller }).should.be.fulfilled;
    feeSetOnlyUser.iadd(getGasFee(receiptSetOnlyUser));

    await payments.relayedWithdraw(paymentData.seller).should.be.fulfilled;

    expectedPaymentsSeller = toBN(0);
    expectedNativeSeller.iadd(toBN(sellerAmount)).isub(feeSetOnlyUser);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the external balance
    await payments.relayedWithdraw(feesCollector).should.be.fulfilled;

    expectedPaymentsFeesCollector = toBN(0);
    expectedNativeFeesCollector.iadd(toBN(feeAmount));

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('Repeated payments lead to addition of funds', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.paymentId = '0xa884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';

    const paymentData3 = JSON.parse(JSON.stringify(paymentData));
    paymentData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    paymentData3.seller = bob;

    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBob = toBN(await web3.eth.getBalance(bob));

    // We will do 2 payments with equal seller, and 1 with a different seller (Bob)
    await buyNow(paymentData, initialBuyerETH);
    await buyNow(paymentData2, initialBuyerETH);
    await buyNow(paymentData3, initialBuyerETH);

    await finalize(paymentData.paymentId, true, operatorPrivKey);
    await finalize(paymentData2.paymentId, true, operatorPrivKey);
    await finalize(paymentData3.paymentId, true, operatorPrivKey);

    const fee1 = getGasFee(await payments.withdraw({ from: feesCollector }));
    const fee2 = getGasFee(await payments.withdraw({ from: paymentData.seller }));
    const fee3 = getGasFee(await payments.withdraw({ from: bob }));

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    // the feescollector has collected 3 fees
    expectedNativeFeesCollector.iadd(toBN(3 * feeAmount - fee1));
    expectedNativeSeller.iadd(toBN(2 * sellerAmount - fee2));
    expectedNativeBob.iadd(toBN(sellerAmount - fee3));

    await assertBalances(
      'native',
      [paymentData.seller, bob, feesCollector],
      [expectedNativeSeller, expectedNativeBob, expectedNativeFeesCollector],
    );
  });

  it('Reusing local balance works with paying within a range of amounts', async () => {
    // let the future buyer be a seller to get local balance
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.seller = paymentData.buyer;
    paymentData2.buyer = carol; // let the buyer be anyone

    await buyNow(paymentData2, initialBuyerETH);
    await finalize(paymentData2.paymentId, true, operatorPrivKey);

    const feeAmount = Math.floor(Number(paymentData2.amount) * paymentData2.feeBPS) / 10000;

    const expectedLocalBalanceBuyer = toBN(Number(paymentData2.amount) - feeAmount);

    await assertBalances(
      payments,
      [paymentData.buyer],
      [expectedLocalBalanceBuyer],
    );
    // Now the buyer tries to buy reusing balance
    const paymentData3 = JSON.parse(JSON.stringify(paymentData));
    paymentData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    const extraFundsRequired = 123;
    paymentData3.amount = Number(expectedLocalBalanceBuyer) + extraFundsRequired;

    // Cannot provide more than amount
    await truffleAssert.reverts(
      buyNow(paymentData3, initialBuyerETH, paymentData3.amount + 1),
      'new funds provided must be less than bid amount',
    );
    // Cannot provide less than required
    await truffleAssert.reverts(
      buyNow(paymentData3, initialBuyerETH, extraFundsRequired - 1),
      'new funds provided are not within required range',
    );

    // possible to pay just the bare minimum, with no localBalance afterwards:
    const snapshot2 = await timeTravel.takeSnapshot();
    await buyNow(paymentData3, initialBuyerETH, extraFundsRequired);
    await assertBalances(
      payments,
      [paymentData3.buyer],
      [toBN(0)],
    );
    await timeTravel.revertToSnapShot(snapshot2.result);

    // possible to pay some excess, with local balance afterwards
    await buyNow(paymentData3, initialBuyerETH, extraFundsRequired + 22);
    await assertBalances(
      payments,
      [paymentData3.buyer],
      [toBN(22)],
    );
  });

  it('Withdraw of portion of available funds works', async () => {
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));

    await buyNow(paymentData, initialBuyerETH);
    await finalize(paymentData.paymentId, true, operatorPrivKey);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    // seller withdraws all local balance except for 20 ETH
    const amountToWithdraw = sellerAmount - 20;
    const receipt = await payments.withdrawAmount(amountToWithdraw, { from: paymentData.seller });
    const sellerGasFee = getGasFee(receipt);

    // seller should have 20 ETH in local balance, and an extra amount (minus gas fees) outside the contract
    expectedNativeSeller.iadd(toBN(amountToWithdraw - sellerGasFee));
    const expectedLocalBalanceSeller = toBN(20);

    await assertBalances(
      'native',
      [paymentData.seller],
      [expectedNativeSeller],
    );

    await assertBalances(
      payments,
      [paymentData.seller],
      [expectedLocalBalanceSeller],
    );

    // seller can further withdraw 5 more
    const receipt2 = await payments.withdrawAmount(5, { from: paymentData.seller });
    const sellerGasFee2 = getGasFee(receipt2);

    // balances in-contract and out-contract are as expected:
    expectedNativeSeller.iadd(toBN(5 - sellerGasFee2));
    expectedLocalBalanceSeller.isub(toBN(5));

    await assertBalances(
      'native',
      [paymentData.seller],
      [expectedNativeSeller],
    );

    await assertBalances(
      payments,
      [paymentData.seller],
      [expectedLocalBalanceSeller],
    );
  });

  it('Withdraw of portion of available funds fails if not enough local funds', async () => {
    await buyNow(paymentData, initialBuyerETH);
    await finalize(paymentData.paymentId, true, operatorPrivKey);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    // seller withdraws all local balance except for 20 ETH
    const amountToWithdraw = sellerAmount + 1;
    await truffleAssert.reverts(
      payments.withdrawAmount(amountToWithdraw, { from: paymentData.seller }),
      'not enough balance to withdraw specified amount.',
    );
  });

  it('From PAID: no further action is accepted', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    const { signature } = await buyNow(paymentData, initialBuyerETH);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    // try assetTransferSuccess
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try assetTransferFails
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try to buyNow again
    await truffleAssert.reverts(
      payments.buyNow(paymentData, signature, { from: paymentData.buyer }),
      'payment in incorrect current state',
    );
  });

  it('From ASSET_TRANSFER: buyer is refunded when asset transfer fails', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the external balance
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    // When payment moves to REFUNDED, balances have been updated with buyer's refund:
    await finalize(paymentData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // Check BuyerRefund event:
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);

    expectedPaymentsBuyer.iadd(toBN(paymentData.amount));

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdrawal, she sees the tokens back in the external balance
    const fee = getGasFee(await payments.withdraw({ from: paymentData.buyer }));

    // Check withdraw event:
    const past2 = await payments.getPastEvents('Withdraw', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past2[0].args.user, paymentData.buyer);
    assert.equal(past2[0].args.amount, paymentData.amount);

    expectedNativeBuyer.iadd(toBN(paymentData.amount - fee));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('From expired: buyer can withdraw', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(paymentData.seller));
    const expectedNativeBuyer = toBN(0);
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));

    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the external balance
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await buyNow(paymentData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    // Let's move to FAILED by going beyond expiration time:
    const paymentWindow = await payments.paymentWindow();
    // wait just before expiration time, and check that state has not changed yet
    await timeTravel.wait(Number(paymentWindow) + 10);

    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);

    // note that anyone can do this, not necessarily the interested party:
    await payments.refund(paymentData.paymentId, { from: bob }).should.be.fulfilled;

    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // only the samll unused amount should remain as local balance
    expectedPaymentsBuyer = toBN(paymentData.amount);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdraw, buyer sees the tokens back in the external balance
    const receipt = await payments.withdraw({ from: paymentData.buyer });
    const fee = getGasFee(receipt);

    expectedNativeBuyer.iadd(toBN(paymentData.amount - fee));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      'native',
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [paymentData.buyer, paymentData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('finalize: only operator is authorized to sign', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, false, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
  });

  it('ASSET_TRANSFERRING moves to PAID when someone relays operator confirmation of asset transfer success', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), PAID);

    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const sellerAmount = Number(paymentData.amount) - feeAmount;

    await assertBalances(
      payments,
      [paymentData.seller, feesCollector],
      [sellerAmount, feeAmount],
    );

    // Check PAY event
    const past = await payments.getPastEvents('Paid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
  });

  it('ASSET_TRANSFERRING moves to REFUNDED when someone realays operator confirmation of asset transfer failed', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await finalize(paymentData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);

    // check event
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
  });

  it('From NOT_STARTED: not possible to confirm asset transfer failure or success', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    assert.equal(await payments.paymentState(paymentData.paymentId), NOT_STARTED);

    // Fails to recognize operator because all paymentData have been deleted
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, false, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
  });

  it('ASSET_TRANSFERRING allows ACCEPTS_REFUND after expiration time', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    const paymentWindow = await payments.paymentWindow();
    // wait just before expiration time, and check that state has not changed yet
    await timeTravel.wait(Number(paymentWindow) - 100);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), false);
    // wait the remainder period to get beyond expiration time,
    await timeTravel.wait(101);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), true);
    // note that the written state has not changed, though:
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
  });

  it('ACCEPTS_REFUNDS: anyone can refundAndWithdraw in one transaction if allowed', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;

    const expectedNativeBuyer = toBN(await web3.eth.getBalance(paymentData.buyer));

    const { gasFee } = await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);

    // wait beyond payment window to move to FAILED
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.wait(Number(paymentWindow) + 5);
    assert.equal(await payments.acceptsRefunds(paymentData.paymentId), true);
    // Check expected external balance of buyer before refunding:
    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(paymentData.amount))
      .isub(gasFee);

    await assertBalances('native', [paymentData.buyer], [expectedNativeBuyer]);

    // Anyone can execute refundAndWithdraw because bidder has not declared otherwise
    assert.equal(await payments.onlyUserCanWithdraw(paymentData.buyer), false);
    await payments.refundAndWithdraw(paymentData.paymentId, { from: bob });

    assert.equal(await payments.paymentState(paymentData.paymentId), REFUNDED);
    // After refundAndWithdraw: no balance in payments contract, all funds refunded
    expectedNativeBuyer.iadd(toBN(paymentData.amount));
    await assertBalances(payments, [paymentData.buyer], [0]);
    await assertBalances('native', [paymentData.buyer], [expectedNativeBuyer]);
  });

  it('ASSET_TRANSFERRING blocks another Payment', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    const { signature } = await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.buyNow(paymentData, signature, { from: paymentData.buyer, value: paymentData.amount }),
      'payment in incorrect current state',
    );
  });

  it('ASSET_TRANSFERRING blocks refund', async () => {
    await payments.registerAsSeller({ from: paymentData.seller }).should.be.fulfilled;
    await buyNow(paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.refund(paymentData.paymentId),
      'payment does not accept refunds at this stage',
    );
  });

  it('if isSellerRegistrationRequired == false, no need to register', async () => {
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBuyNow({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    // fails unless registration is not required:
    assert.equal(await payments.isRegisteredSeller(paymentData.seller), false);
    await truffleAssert.reverts(
      payments.buyNow(paymentData, signature, { from: paymentData.buyer, value: paymentData.amount }),
      'seller not registered',
    );
    await payments.setIsSellerRegistrationRequired(false, { from: deployer }).should.be.fulfilled;
    await payments.buyNow(paymentData, signature, { from: paymentData.buyer, value: paymentData.amount }).should.be.fulfilled;
  });

  it('Payment requirements are correctly checked', async () => {
    // This test checks the fulfillment of all requirements to accept a payment
    // By starting with not fulfilling any, checking revert messages, then
    // fulfilling one & checking new revert message, etc., until accepted.
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;

    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.amount = String(initialBuyerETH + 123);

    // Carol will be the buyer:
    assert.equal(paymentData2.buyer, buyerAccount.address);
    // And also funding Carol with ETH so that she can approve
    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    // should fail unless the buyer is the sender of the TX
    await truffleAssert.reverts(
      payments.buyNow(paymentData2, dummySignature, { from: operator, value: paymentData2.amount }),
      'only buyer can execute this function',
    );

    await truffleAssert.fails(
      payments.buyNow(paymentData2, dummySignature, { from: paymentData2.buyer, value: paymentData2.amount }),
      'incorrect operator signature',
    );

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBuyNow({
        msg: paymentData2,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    await truffleAssert.fails(
      payments.buyNow(paymentData2, signature, { from: paymentData2.buyer, value: paymentData2.amount }),
      'seller not registered',
    );

    await payments.registerAsSeller({ from: paymentData2.seller }).should.be.fulfilled;

    // fails due to insufficient funds:
    await payments.buyNow(paymentData2, signature, { from: paymentData2.buyer, value: paymentData2.amount }).should.be.rejected;

    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    // fails unless fee is below 100%
    const wrongPaymentData2 = JSON.parse(JSON.stringify(paymentData2));
    wrongPaymentData2.feeBPS = 10100;

    await truffleAssert.fails(
      buyNow(wrongPaymentData2, 0),
      'fee cannot be larger than 100 percent',
    );

    // it finally is accepted
    await payments.buyNow(paymentData2, signature, { from: paymentData2.buyer, value: paymentData2.amount }).should.be.fulfilled;
  });
});
