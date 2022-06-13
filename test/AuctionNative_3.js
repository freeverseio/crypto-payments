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

contract('AuctionNative3', (accounts) => {
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

  it('endsAt cannot be null', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.endsAt = 0;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'endsAt cannot be in the past.',
    );
  });

  it('AUCTIONING moves to ASSET TRANSFERRING after endsAt', async () => {
    await bid(bidData, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);
    await timeTravel.waitUntil(endsAt - 10);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('Auctions are not extended when bidding before approaching the end of the auction', async () => {
    const bidData0 = JSON.parse(JSON.stringify(bidData));
    bidData0.bidAmount = 100;
    // make sure the authorization to pay is not blocking;
    bidData0.deadline = endsAt * 10;

    // make two bids
    await bid(bidData0, initialBuyerETH);

    const bidIncrease = 200;
    bidData0.bidAmount += bidIncrease;
    await bid(bidData0, 0, bidIncrease);

    // check that the change of state happens at the original endsAt

    await timeTravel.waitUntil(endsAt - 20);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    await timeTravel.waitUntil(endsAt + 20);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('Auctions can be extended with new bids', async () => {
    const bidData0 = JSON.parse(JSON.stringify(bidData));
    bidData0.bidAmount = 100;
    // make sure the authorization to pay is not blocking;
    bidData0.deadline = endsAt * 10;

    // make an initial bid
    await bid(bidData0, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    // for each bid:
    // - first move close to the new endsAt of the auction
    // - then bid, and increment the expected endsAt
    // - keep checking that the auction remains in AUCTIONING STATE
    let beforeEndsAt = endsAt - 50;
    for (let b = 0; b < 3; b += 1) {
      await timeTravel.waitUntil(beforeEndsAt);
      const bidIncrease = Math.floor(0.06 * bidData0.bidAmount);
      bidData0.bidAmount += bidIncrease;
      await bid(bidData0, 0, bidIncrease);
      assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);
      beforeEndsAt += defaultTimeToExtend;
    }

    await timeTravel.waitUntil(beforeEndsAt + 100);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('Auctions can not be created such that extendableUntil is too close to expirationTime', async () => {
    // This test shows that auctions need to be created unless enough time is left
    // for the asset transfer stage before the expiration time.
    // Note that:
    // - extendableUntil = endsAt + extendableBy
    // - expirationTime  = endsAt + paymentWindow;
    const paymentWindow = Number(await payments.paymentWindow());
    let extendableBy = paymentWindow - 3600 * 1;
    await payments.setDefaultAuctionConfig(1, 1, extendableBy);
    await truffleAssert.reverts(
      bid(bidData, initialBuyerETH),
      'cannot start auction that is extendable too close to expiration time',
    );

    extendableBy = paymentWindow - 3600 * 2 + 1;
    await payments.setDefaultAuctionConfig(1, 1, extendableBy);
    await truffleAssert.reverts(
      bid(bidData, initialBuyerETH),
      'cannot start auction that is extendable too close to expiration time',
    );

    extendableBy = paymentWindow - 3600 * 2 - 1;
    await payments.setDefaultAuctionConfig(1, 1, extendableBy);
    await bid(bidData, initialBuyerETH).should.be.fulfilled;
  });
});
