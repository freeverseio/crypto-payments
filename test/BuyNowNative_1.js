/* eslint-disable max-len */
/* eslint-disable no-undef */

const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBuyNow, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const {
  fromHexString, toBN, provideFunds, registerAccountInLocalTestnet, getGasFee, assertBalances, addressFromPk, generateSellerSig,
} = require('../helpers/utils');
const { TimeTravel } = require('../helpers/TimeTravel');

require('chai')
  .use(require('chai-as-promised'))
  .should();

const EIP712Verifier = artifacts.require('EIP712VerifierBuyNow');
const BuyNowNative = artifacts.require('BuyNowNative');

contract('BuyNowNative1', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const [deployer] = accounts;
  const feesCollector = deployer;
  const sellerPrivKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const sellerAccount = web3.eth.accounts.privateKeyToAccount(sellerPrivKey);
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const alice = sellerAccount.address;
  const operator = operatorAccount.address;
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
  // eslint-disable-next-line no-unused-vars
  const [NOT_STARTED, ASSET_TRANSFERRING, REFUNDED, PAID] = [0, 1, 2, 3];
  const initialBuyerETH = 1000000000000000000;
  const initialOperatorETH = 6000000000000000000;
  const timeTravel = new TimeTravel(web3);
  const minimalSupply = Math.round(Number(initialBuyerETH) / 10);

  let eip712;
  let payments;
  let snapshot;

  beforeEach(async () => {
    snapshot = await timeTravel.takeSnapshot();
    eip712 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;
    payments = await BuyNowNative.new(CURRENCY_DESCRIPTOR, eip712.address).should.be.fulfilled;
    await registerAccountInLocalTestnet(sellerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(buyerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(operatorAccount).should.be.fulfilled;
    await provideFunds(deployer, operator, initialOperatorETH);
    await payments.setUniverseOperator(
      paymentData.universeId,
      operator,
    ).should.be.fulfilled;
  });

  afterEach(async () => {
    await timeTravel.revertToSnapShot(snapshot.result);
  });

  async function finalize(_paymentId, _success, _operatorPvk) {
    const data = { paymentId: _paymentId, wasSuccessful: _success };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(_operatorPvk.slice(2)),
      prepareDataToSignAssetTransfer({
        msg: data,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );
    await payments.finalize(
      data,
      signature,
    );
  }

  // Executes a Payment directly by buyer. Reused by many tests.
  // It first funds the buyer, then buyer approves, operators signs,
  // and the buyer relays the payment.
  async function buyNow(_sellerPrivKey, _paymentData, _ETHSupplyForBuyer) {
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
    const sigSeller = generateSellerSig(_sellerPrivKey, _paymentData.paymentId);
    await provideFunds(deployer, addressFromPk(_sellerPrivKey), minimalSupply);
    await payments.registerAsSeller({ from: _paymentData.seller }).should.be.fulfilled;
    await payments.buyNow(_paymentData, signature, sigSeller, { from: _paymentData.buyer, value: _paymentData.amount });
    return signature;
  }

  // eslint-disable-next-line no-unused-vars

  it('payments start in NOT_STARTED state', async () => {
    assert.equal(await payments.paymentState(paymentData.paymentId), NOT_STARTED);
  });

  it('Payment execution results in funds received by Payments contract', async () => {
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);
    assert.equal(Number(await web3.eth.getBalance(payments.address)), paymentData.amount);
  });

  it('Payment execution fails if deadline to pay expired', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('Payment info is stored correctly', async () => {
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);
    assert.equal(await payments.paymentState(paymentData.paymentId), ASSET_TRANSFERRING);
    const info = await payments.paymentInfo(paymentData.paymentId);
    assert.equal(info.state, ASSET_TRANSFERRING);
    assert.equal(info.buyer, paymentData.buyer);
    assert.equal(info.seller, paymentData.seller);
    assert.equal(info.universeId, paymentData.universeId);
    assert.equal(info.feesCollector, feesCollector);
    assert.equal(Number(info.expirationTime) > 100, true);
    assert.equal(Number(info.feeBPS) > 1, true);
    assert.equal(info.amount, paymentData.amount);
  });

  it('Events are emitted in a payment', async () => {
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);
    const past = await payments.getPastEvents('BuyNow', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
    assert.equal(past[0].args.seller, paymentData.seller);
  });

  it('Events are emitted in a payment', async () => {
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);
    const past = await payments.getPastEvents('BuyNow', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, paymentData.paymentId);
    assert.equal(past[0].args.buyer, paymentData.buyer);
    assert.equal(past[0].args.seller, paymentData.seller);
  });

  it('Users can set onlyUserCanWithdraw', async () => {
    await provideFunds(deployer, alice, minimalSupply);
    assert.equal(await payments.onlyUserCanWithdraw(alice), false);
    await payments.setOnlyUserCanWithdraw(true, { from: alice }).should.be.fulfilled;
    assert.equal(await payments.onlyUserCanWithdraw(alice), true);

    await payments.setOnlyUserCanWithdraw(false, { from: alice }).should.be.fulfilled;
    assert.equal(await payments.onlyUserCanWithdraw(alice), false);

    // check events:
    const past = await payments.getPastEvents('OnlyUserCanWithdraw', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.user, alice);
    assert.equal(past[0].args.onlyUserCanWithdraw, true);
    assert.equal(past[1].args.user, alice);
    assert.equal(past[1].args.onlyUserCanWithdraw, false);
  });

  it('Sellers can register', async () => {
    assert.equal(await payments.isRegisteredSeller(alice), false);
    await provideFunds(deployer, alice, minimalSupply);
    await payments.registerAsSeller({ from: alice }).should.be.fulfilled;
    assert.equal(await payments.isRegisteredSeller(alice), true);

    // check event:
    const past = await payments.getPastEvents('NewSeller', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.seller, alice);
  });

  it('Sellers cannot register more than once', async () => {
    await provideFunds(deployer, alice, minimalSupply);
    await payments.registerAsSeller({ from: alice }).should.be.fulfilled;
    await truffleAssert.reverts(
      payments.registerAsSeller({ from: alice }),
      'seller already registered',
    );
  });

  it('Payments deploys with expected storage', async () => {
    assert.equal(await payments.isSellerRegistrationRequired(), false);
    assert.equal(await payments.currencyLongDescriptor(), CURRENCY_DESCRIPTOR);
    assert.equal(await payments.defaultOperator(), accounts[0]);
    assert.equal(await payments.defaultFeesCollector(), accounts[0]);
    assert.equal(await payments.owner(), accounts[0]);
    assert.equal(await payments.EIP712Address(), eip712.address);
    assert.equal(Number(await payments.paymentWindow()), 30 * 24 * 3600);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), 0);
    assert.equal(Number(await payments.balanceOf(paymentData.buyer)), 0);
  });

  it('Set EIP712 verifier contract works as expected', async () => {
    // on deploy:
    let past = await payments.getPastEvents('EIP712', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.eip712address, eip712.address);
    assert.equal(past[0].args.prevEip712address, '0x0000000000000000000000000000000000000000');

    // after deploy:
    const newAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    await truffleAssert.reverts(
      payments.setEIP712(newAddress, { from: alice }),
      'caller is not the owner',
    );
    await payments.setEIP712(newAddress, { from: deployer }).should.be.fulfilled;
    assert.equal(Number(await payments.EIP712Address()), newAddress);

    // check event
    past = await payments.getPastEvents('EIP712', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[1].args.eip712address, newAddress);
    assert.equal(past[1].args.prevEip712address, eip712.address);
  });

  it('Set isSellerRegistrationRequired', async () => {
    await truffleAssert.reverts(
      payments.setIsSellerRegistrationRequired(false, { from: alice }),
      'caller is not the owner',
    );
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    assert.equal(await payments.isSellerRegistrationRequired(), true);
  });

  it('Set payment window works if within limits', async () => {
    // on deploy:
    let past = await payments.getPastEvents('PaymentWindow', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    const days30 = 30 * 24 * 3600;
    assert.equal(past[0].args.window, days30);
    assert.equal(past[0].args.prevWindow, 0);

    // after deploy:
    const newVal = 12345;
    await truffleAssert.reverts(
      payments.setPaymentWindow(newVal, { from: alice }),
      'caller is not the owner',
    );
    await payments.setPaymentWindow(newVal, { from: deployer }).should.be.fulfilled;
    assert.equal(Number(await payments.paymentWindow()), newVal);

    // check event
    past = await payments.getPastEvents('PaymentWindow', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[1].args.window, newVal);
    assert.equal(past[1].args.prevWindow, days30);
  });

  it('Set payment window fails if below limit', async () => {
    const oneHour = 3600;
    await truffleAssert.reverts(
      payments.setPaymentWindow(3 * oneHour - 1, { from: deployer }),
      'payment window outside limits',
    );
    await payments.setPaymentWindow(3 * oneHour + 1, { from: deployer }).should.be.fulfilled;
  });

  it('Set payment window fails if above limit', async () => {
    const oneDay = 24 * 3600;
    await truffleAssert.reverts(
      payments.setPaymentWindow(60 * oneDay + 1, { from: deployer }),
      'payment window outside limits',
    );
    await payments.setPaymentWindow(60 * oneDay - 1, { from: deployer }).should.be.fulfilled;
  });

  it('Test fee computation', async () => {
    assert.equal(Number(await payments.computeFeeAmount(9, 500)), 0);
    assert.equal(Number(await payments.computeFeeAmount(99, 100)), 0);
    assert.equal(Number(await payments.computeFeeAmount(100, 100)), 1);
    assert.equal(Number(await payments.computeFeeAmount(100, 500)), 5);
    assert.equal(Number(await payments.computeFeeAmount(123456, 7)), 86);
    assert.equal(Number(await payments.computeFeeAmount('1234560000000000000000', 10)), 1234560000000000000);
  });

  it('finalize must be called by the latest available operator, not the one in the original payment', async () => {
    // create BuyNow with initial operator
    const initialOperator = await payments.universeOperator(paymentData.universeId);
    assert.equal(initialOperator, operator);
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);

    // change operator:
    await payments.setUniverseOperator(paymentData.universeId, paymentData.buyer);
    assert.equal(await payments.universeOperator(paymentData.universeId), paymentData.buyer);

    // should fail: try to finalize with initial operator
    await truffleAssert.reverts(
      finalize(paymentData.paymentId, true, operatorPrivKey),
      'only the operator can sign an assetTransferResult',
    );

    // should work: finalize with current operator
    await finalize(paymentData.paymentId, true, buyerPrivKey).should.be.fulfilled;
  });

  it('Test splitFundingSources with no local balance', async () => {
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), 0);

    let split = await payments.splitFundingSources(paymentData.seller, 0);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), 0);

    split = await payments.splitFundingSources(paymentData.seller, 10);
    assert.equal(Number(split.externalFunds), 10);
    assert.equal(Number(split.localFunds), 0);
  });

  it('Test splitFundingSources with non-zero local balance', async () => {
    // First complete a sell, so that seller has local balance
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);
    await finalize(paymentData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const localFunds = toBN(Number(paymentData.amount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), localFunds);

    // when amount is larger than local funds:
    let amount = localFunds.add(toBN(5));
    let split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.externalFunds), 5);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), amount);

    // when amount is less than local funds:
    amount = localFunds.sub(toBN(5));
    split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), Number(amount));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), amount);
  });

  it('Payments with 0 amount are not accepted', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.amount = 0;
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData2, initialBuyerETH),
      'payment amount cannot be zero',
    );
  });

  it('assertBuyNowInputsOK fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.feeBPS = 10001;
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData2, initialBuyerETH),
      'fee cannot be larger than maxFeeBPS',
    );
  });

  it('assertBuyNowInputsOK fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.deadline = 1;
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData2, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('assertBuyNowInputsOK fails on bad fees value', async () => {
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.feeBPS = 10022;
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData2, initialBuyerETH),
      'fee cannot be larger than maxFeeBPS',
    );
  });

  it('enoughFundsAvailable by providing more funds to buyer', async () => {
    // initially buyer has no funds anywhere
    assert.equal(await payments.maxFundsAvailable(paymentData.buyer), 0);
    assert.equal(await payments.enoughFundsAvailable(paymentData.buyer, 10), false);

    await provideFunds(deployer, buyerAccount.address, initialBuyerETH);

    assert.equal(await payments.maxFundsAvailable(paymentData.buyer), initialBuyerETH);
    assert.equal(await payments.enoughFundsAvailable(paymentData.buyer, 10), true);
  });

  it('enoughFundsAvailable by using part in local balance', async () => {
    await buyNow(sellerPrivKey, paymentData, initialBuyerETH);

    const sellerInitBalance = await web3.eth.getBalance(paymentData.seller);

    await finalize(paymentData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(paymentData.amount) * paymentData.feeBPS) / 10000;
    const localFunds = toBN(Number(paymentData.amount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(paymentData.seller)), localFunds);

    const expectedSellerBalance = toBN(sellerInitBalance)
      .add(toBN(paymentData.amount))
      .sub(toBN(feeAmount));
    // check that it returns: still, not enough available:
    assert.equal(
      String(await payments.maxFundsAvailable(paymentData.seller)),
      String(expectedSellerBalance),
    );

    const extraNeeded = toBN(123);
    const amount = expectedSellerBalance.add(extraNeeded);
    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), false);

    // Check that the split computed is as expected
    const split = await payments.splitFundingSources(paymentData.seller, amount);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(
      String(split.externalFunds),
      String(amount.sub(split.localFunds)),
    );

    // it works after actually having the correct balance
    await provideFunds(deployer, paymentData.seller, initialBuyerETH);

    assert.equal(await payments.enoughFundsAvailable(paymentData.seller, amount), true);
  });

  it('Operator cannot coincide with buyer', async () => {
    // Prepare paymentData where the buyer coincides with the operator:
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.buyer = operator;

    // Payment fails
    await truffleAssert.reverts(
      buyNow(sellerPrivKey, paymentData2, initialBuyerETH),
      'operator must be an observer',
    );
  });

  it('Operator cannot coincide with seller', async () => {
    // Prepare paymentData where the seller coincides with the operator:
    const paymentData2 = JSON.parse(JSON.stringify(paymentData));
    paymentData2.seller = operator;

    // Payment fails
    await truffleAssert.reverts(
      buyNow(operatorPrivKey, paymentData2, initialBuyerETH),
      'operator must be an observer',
    );
  });
});
