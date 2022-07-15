/* eslint-disable no-await-in-loop */
/* eslint-disable no-undef */

const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBid, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const {
  fromHexString, toBN, provideFunds, registerAccountInLocalTestnet, getGasFee, assertBalances,
} = require('../helpers/utils');
const { TimeTravel } = require('../helpers/TimeTravel');

require('chai')
  .use(require('chai-as-promised'))
  .should();

const EIP712Verifier = artifacts.require('EIP712VerifierAuction');
const AuctionNative = artifacts.require('AuctionNative');

contract('AuctionNative1', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const defaultMinPercent = 500; // 5%
  const defaultTimeToExtend = 10 * 60; // 10 min
  const defaultExtendableBy = 24 * 3600; // 1 day
  const [deployer, alice] = accounts;
  const feesCollector = deployer;
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const operator = operatorAccount.address;
  const defaultAmount = 300;
  const defaultFeeBPS = 500; // 5%
  const now = Math.floor(Date.now() / 1000);
  const timeToPay = 15 * 60; // 15 minutes
  const deadline = now + timeToPay;
  const endsAt = now + 3600; // in one hour
  const bidData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    endsAt,
    bidAmount: defaultAmount.toString(),
    feeBPS: defaultFeeBPS,
    universeId: '1',
    deadline,
    bidder: buyerAccount.address,
    seller: alice,
  };
  // eslint-disable-next-line no-unused-vars
  const [NOT_STARTED, ASSET_TRANSFERRING, REFUNDED, PAID, AUCTIONING] = [0, 1, 2, 3, 4];
  const initialBuyerETH = 1000000000000000000;
  const initialOperatorETH = 6000000000000000000;
  const timeTravel = new TimeTravel(web3);

  let eip712;
  let payments;
  let snapshot;

  beforeEach(async () => {
    snapshot = await timeTravel.takeSnapshot();
    eip712 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;
    payments = await AuctionNative.new(
      CURRENCY_DESCRIPTOR,
      eip712.address,
      defaultMinPercent,
      defaultTimeToExtend,
      defaultExtendableBy,
    ).should.be.fulfilled;
    await registerAccountInLocalTestnet(buyerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(operatorAccount).should.be.fulfilled;
    await provideFunds(deployer, operator, initialOperatorETH);
    await payments.setUniverseOperator(
      bidData.universeId,
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

  // Executes a Bid directly by buyer. Reused by many tests.
  // It first funds the buyer with _ETHSupplyForBuyer,
  // then builds the signature bt the operator,
  // and the buyer relays the payment and provides funds.
  // If _txAmount is specified, it provides the exact _txAmount,
  // otherwise it provides _bidData.bidAmount;
  // this is useful when the user already have funds in the contract
  // and just needs an amount less than bidAmount to be provided.
  async function bid(_bidData, _ETHSupplyForBuyer, _txAmount) {
    await provideFunds(deployer, _bidData.bidder, _ETHSupplyForBuyer);

    // Operator signs purchase
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBid({
        msg: _bidData,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    // Pay
    const value = _txAmount >= 0 ? _txAmount : _bidData.bidAmount;
    await payments.bid(_bidData, signature, { from: _bidData.bidder, value });
    return signature;
  }

  // eslint-disable-next-line no-unused-vars

  it('Bid execution results in funds received by Payments contract', async () => {
    await bid(bidData, initialBuyerETH);
    assert.equal(Number(await web3.eth.getBalance(payments.address)), bidData.bidAmount);
  });

  it('Bid execution fails if deadline to bid expired', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      bid(bidData, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('Cannot set zero minPercentage', async () => {
    // reverts on set default
    await truffleAssert.reverts(
      payments.setDefaultAuctionConfig(0, defaultTimeToExtend, defaultExtendableBy),
      'minIncreasePercentage must be non-zero.',
    );
    // reverts on set universe specific
    const universeId = 12;
    await truffleAssert.reverts(
      payments.setUniverseAuctionConfig(universeId, 0, defaultTimeToExtend, defaultExtendableBy),
      'minIncreasePercentage must be non-zero.',
    );
    // reverts on deploy
    await truffleAssert.fails(
      AuctionNative.new(
        CURRENCY_DESCRIPTOR,
        eip712.address,
        0,
        defaultTimeToExtend,
        defaultExtendableBy,
      ),
      'minIncreasePercentage must be non-zero',
    );
  });

  it('Correct default auctionConfig on deploy', async () => {
    const conf = await payments.defaultAuctionConfig();
    assert.equal(Number(await conf.timeToExtend), defaultTimeToExtend);
    assert.equal(await conf.minIncreasePercentage, defaultMinPercent);
    assert.equal(await conf.timeToExtend, defaultTimeToExtend);
    assert.equal(await conf.extendableBy, defaultExtendableBy);

    const past = await payments.getPastEvents('DefaultAuctionConfig', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.minIncreasePercentage, defaultMinPercent);
    assert.equal(past[0].args.prevMinIncreasePercentage, 0);
    assert.equal(past[0].args.timeToExtend, defaultTimeToExtend);
    assert.equal(past[0].args.prevTimeToExtend, 0);
    assert.equal(past[0].args.extendableBy, defaultExtendableBy);
    assert.equal(past[0].args.prevExtendableBy, 0);

    const universeId = 12;
    assert.equal(await payments.universeMinIncreasePercentage(universeId), defaultMinPercent);
    assert.equal(await payments.universeTimeToExtend(universeId), defaultTimeToExtend);
    assert.equal(await payments.universeExtendableBy(universeId), defaultExtendableBy);
  });

  it('Only owner can change AuctionConfigs', async () => {
    await truffleAssert.reverts(
      payments.setDefaultAuctionConfig(
        defaultMinPercent,
        defaultTimeToExtend,
        defaultExtendableBy,
        { from: alice },
      ),
      'Ownable: caller is not the owner',
    );
    const universeId = 12;
    await truffleAssert.reverts(
      payments.setUniverseAuctionConfig(
        universeId,
        defaultMinPercent,
        defaultTimeToExtend,
        defaultExtendableBy,
        { from: alice },
      ),
      'Ownable: caller is not the owner',
    );
  });

  it('Correct change of default AuctionConfig', async () => {
    const newMin = 33;
    const newTime = 34;
    const newExtendable = 35;
    await payments.setDefaultAuctionConfig(
      newMin,
      newTime,
      newExtendable,
    ).should.be.fulfilled;
    const conf = await payments.defaultAuctionConfig();
    assert.equal(conf.minIncreasePercentage, newMin);
    assert.equal(conf.timeToExtend, newTime);
    assert.equal(conf.extendableBy, newExtendable);
    const past = await payments.getPastEvents('DefaultAuctionConfig', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[1].args.minIncreasePercentage, newMin);
    assert.equal(past[1].args.timeToExtend, newTime);
    assert.equal(past[1].args.extendableBy, newExtendable);
    assert.equal(past[1].args.prevMinIncreasePercentage, defaultMinPercent);
    assert.equal(past[1].args.prevTimeToExtend, defaultTimeToExtend);
    assert.equal(past[1].args.prevExtendableBy, defaultExtendableBy);

    const universeId = 12;
    assert.equal(await payments.universeMinIncreasePercentage(universeId), newMin);
    assert.equal(await payments.universeTimeToExtend(universeId), newTime);
    assert.equal(await payments.universeExtendableBy(universeId), newExtendable);
  });

  it('Correct change of universe specific AuctionConfig', async () => {
    const newMin = 33;
    const newTime = 34;
    const newExtendable = 35;
    const universeId = 12;
    await payments.setUniverseAuctionConfig(
      universeId,
      newMin,
      newTime,
      newExtendable,
    ).should.be.fulfilled;
    const conf = await payments.universeAuctionConfig(universeId);
    assert.equal(conf.minIncreasePercentage, newMin);
    assert.equal(conf.timeToExtend, newTime);
    assert.equal(conf.extendableBy, newExtendable);
    const past = await payments.getPastEvents('UniverseAuctionConfig', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;

    assert.equal(past[0].args.universeId, universeId);
    assert.equal(past[0].args.minIncreasePercentage, newMin);
    assert.equal(past[0].args.timeToExtend, newTime);
    assert.equal(past[0].args.extendableBy, newExtendable);

    // note that the prev values of the stuct are 0
    // (the query universeAuctionConfig returns the stored struct, without logic)
    assert.equal(past[0].args.prevMinIncreasePercentage, 0);
    assert.equal(past[0].args.prevTimeToExtend, 0);
    assert.equal(past[0].args.prevExtendableBy, 0);
    assert.equal(await payments.universeMinIncreasePercentage(universeId), newMin);
    assert.equal(await payments.universeTimeToExtend(universeId), newTime);
    assert.equal(await payments.universeExtendableBy(universeId), newExtendable);
  });

  it('Bid emits correct event', async () => {
    await bid(bidData, initialBuyerETH);
    const past = await payments.getPastEvents('Bid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
    assert.equal(past[0].args.bidder, bidData.bidder);
    assert.equal(past[0].args.seller, bidData.seller);
    assert.equal(past[0].args.bidAmount, bidData.bidAmount);
    assert.equal(past[0].args.endsAt, bidData.endsAt);
  });

  it('Bid info is stored correctly if bid takes place before the last minutes', async () => {
    await bid(bidData, initialBuyerETH);

    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);
    const info = await payments.paymentInfo(bidData.paymentId);
    assert.equal(info.state, AUCTIONING);
    assert.equal(info.buyer, bidData.bidder);
    assert.equal(info.seller, bidData.seller);
    assert.equal(info.universeId, bidData.universeId);
    assert.equal(info.feesCollector, feesCollector);
    assert.equal(Number(info.expirationTime) > 100, true);
    assert.equal(Number(info.feeBPS) > 1, true);
    assert.equal(info.amount, bidData.bidAmount);
    const auctionsSpecifics = await payments.existingAuction(bidData.paymentId);
    assert.equal(auctionsSpecifics.endsAt, bidData.endsAt);
    const extendableBy = Number(await payments.universeExtendableBy(bidData.universeId));
    assert.equal(Number(auctionsSpecifics.extendableUntil), bidData.endsAt + extendableBy);
  });

  it('AUCTIONING moves to ASSET_TRANSFERRING after endsAt', async () => {
    await bid(bidData, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    await timeTravel.waitUntil(endsAt - 30);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    await timeTravel.wait(40);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('Bid info accounts for extra extension if bid takes place within the last minutes', async () => {
    // prepare an auction that finishes in 3 minutes (otherwise identical to previous auctions):
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    const now2 = Math.floor(Date.now() / 1000);
    bidData2.endsAt = now2 + 3 * 60; // in 3 minutes

    // Bid and get info:
    await bid(bidData2, initialBuyerETH);
    const info = await payments.existingAuction(bidData2.paymentId);

    // extendableUntil is as always = endsAt + extendableBy
    const extendableBy = Number(await payments.universeExtendableBy(bidData2.universeId));
    assert.equal(Number(info.extendableUntil), bidData2.endsAt + extendableBy);

    // however, endsAt is already a few minutes later than planned when put forSale
    const newEndsAt = bidData2.endsAt + defaultTimeToExtend;
    assert.equal(Number(info.endsAt), newEndsAt);
    const past = await payments.getPastEvents('Bid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData2.paymentId);
    assert.equal(past[0].args.endsAt, newEndsAt);
  });

  it('Test splitFundingSources with no local balance', async () => {
    assert.equal(Number(await payments.balanceOf(bidData.seller)), 0);

    const testBid = JSON.parse(JSON.stringify(bidData));
    testBid.bidder = testBid.seller;
    testBid.bidAmount = 0;

    let split = await payments.splitAuctionFundingSources(testBid);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), 0);

    testBid.bidAmount = 10;
    split = await payments.splitAuctionFundingSources(testBid);
    assert.equal(Number(split.externalFunds), 10);
    assert.equal(Number(split.localFunds), 0);
  });

  it('finalize cannot be called after bid if not enough time passed', async () => {
    await bid(bidData, initialBuyerETH);
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state.',
    );
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey).should.be.fulfilled;
  });

  it('Test splitFundingSources with non-zero local balance', async () => {
    // First complete a sell, so that seller has local balance
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const localFunds = toBN(Number(bidData.bidAmount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(bidData.seller)), localFunds);

    // when bidAmount is larger than local funds:
    let bidAmount = localFunds.add(toBN(5));
    let split = await payments.splitFundingSources(bidData.seller, bidAmount);
    assert.equal(Number(split.externalFunds), 5);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), bidAmount);

    // when bidAmount is less than local funds:
    bidAmount = localFunds.sub(toBN(5));
    split = await payments.splitFundingSources(bidData.seller, bidAmount);
    assert.equal(Number(split.externalFunds), 0);
    assert.equal(Number(split.localFunds), Number(bidAmount));
    assert.equal(Number(split.externalFunds) + Number(split.localFunds), bidAmount);
  });

  it('Payments with 0 bidAmount are accepted', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidAmount = 0;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'bid amount cannot be 0.',
    );
  });

  it('assertBuyNowInputsOK fails on bad fees value', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.feeBPS = 10001;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'fee cannot be larger than maxFeeBPS',
    );
  });

  it('assertBuyNowInputsOK fails on expired deadline', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.deadline = 1;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('enoughFundsAvailable by using part in local balance', async () => {
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);

    const sellerInitBalance = await web3.eth.getBalance(bidData.seller);

    await finalize(bidData.paymentId, true, operatorPrivKey);
    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const localFunds = toBN(Number(bidData.bidAmount) - feeAmount);
    assert.equal(Number(await payments.balanceOf(bidData.seller)), localFunds);

    const expectedSellerBalance = toBN(sellerInitBalance)
      .add(toBN(bidData.bidAmount))
      .sub(toBN(feeAmount));
    // check that it returns: still, not enough available:
    assert.equal(
      String(await payments.maxFundsAvailable(bidData.seller)),
      String(expectedSellerBalance),
    );

    const extraNeeded = toBN(123);
    const bidAmount = expectedSellerBalance.add(extraNeeded);
    assert.equal(await payments.enoughFundsAvailable(bidData.seller, bidAmount), false);

    // Check that the split computed is as expected
    const split = await payments.splitFundingSources(bidData.seller, bidAmount);
    assert.equal(Number(split.localFunds), Number(localFunds));
    assert.equal(
      String(split.externalFunds),
      String(bidAmount.sub(split.localFunds)),
    );

    // it works after actually having the correct balance
    await provideFunds(deployer, bidData.seller, initialBuyerETH);

    assert.equal(await payments.enoughFundsAvailable(bidData.seller, bidAmount), true);
  });

  it('Operator cannot coincide with bidder', async () => {
    // Prepare paymentData where the buyer coincides with the operator:
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = operator;

    // Bid fails
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'operator must be an observer',
    );
  });

  it('Operator cannot coincide with seller', async () => {
    // Prepare paymentData where the buyer coincides with the operator:
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.seller = operator;

    // Bid fails
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'operator must be an observer',
    );
  });
});
