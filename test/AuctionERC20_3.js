/* eslint-disable max-len */
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

const MyToken = artifacts.require('MyToken');
const EIP712Verifier = artifacts.require('EIP712VerifierAuction');
const AuctionERC20 = artifacts.require('AuctionERC20');

contract('AuctionERC20_3', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const defaultMinPercent = 500; // 5%
  const defaultTimeToExtend = 10 * 60; // 10 min
  const defaultExtendableBy = 24 * 3600; // 1 day
  const [deployer, alice, bob, carol] = accounts;
  const feesCollector = deployer;
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const operator = operatorAccount.address;
  const name = 'MYERC20';
  const symbol = 'FV20';
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
  const initialBuyerERC20 = 100 * Number(bidData.bidAmount);
  const initialOperatorERC20 = 1250 * Number(bidData.bidAmount);
  const initialBuyerETH = 1000000000000000000;
  const initialOperatorETH = 6000000000000000000;
  const timeTravel = new TimeTravel(web3);

  let erc20;
  let eip712;
  let payments;
  let snapshot;

  beforeEach(async () => {
    snapshot = await timeTravel.takeSnapshot();
    erc20 = await MyToken.new(name, symbol).should.be.fulfilled;
    eip712 = await EIP712Verifier.new('LivingAssets ERC20 Payments', '1').should.be.fulfilled;
    payments = await AuctionERC20.new(
      erc20.address,
      CURRENCY_DESCRIPTOR,
      eip712.address,
      defaultMinPercent,
      defaultTimeToExtend,
      defaultExtendableBy,
    ).should.be.fulfilled;
    await registerAccountInLocalTestnet(buyerAccount).should.be.fulfilled;
    await registerAccountInLocalTestnet(operatorAccount).should.be.fulfilled;
    await erc20.transfer(operator, initialOperatorERC20, { from: deployer });
    await provideFunds(deployer, operator, initialOperatorETH);
    await payments.setUniverseOperator(
      bidData.universeId,
      operator,
    ).should.be.fulfilled;
  });

  afterEach(async () => {
    await timeTravel.revertToSnapShot(snapshot.result);
  });

  async function signEIP712(_privKey, _prepareFunc, _data, _isERC20) {
    const sig = await ethSigUtil.signTypedMessage(
      fromHexString(_privKey.slice(2)),
      _prepareFunc({
        msg: _data,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
        isERC20: _isERC20,
      }),
    );
    return sig;
  }

  // Executes a relayedBid. Reused by many tests.
  // It first funds the buyer, then buyer approves, signs, and the operator relays the payment.
  async function relayedBid(_bidData, _ERC20SupplyForBuyer, _ETHSupplyForBuyer, _bidderPK) {
    // Prepare buyerAccount.address to be a buyer: fund her with ERC20, with ETH
    await erc20.transfer(_bidData.bidder, _ERC20SupplyForBuyer, { from: deployer });
    await provideFunds(deployer, _bidData.bidder, _ETHSupplyForBuyer);

    // Buyer approves purchase allowance
    await erc20.approve(payments.address, _bidData.bidAmount, { from: _bidData.bidder }).should.be.fulfilled;

    // Buyer signs purchase
    const bidderPK = _bidderPK || buyerPrivKey;
    const sigBidder = await signEIP712(bidderPK, prepareDataToSignBid, _bidData, true);
    const sigOperator = await signEIP712(operatorPrivKey, prepareDataToSignBid, _bidData, true);
    // Pay
    await payments.relayedBid(_bidData, sigBidder, sigOperator, { from: operator });
  }

  // Executes a Bid directly by buyer. Reused by many tests.
  // It first funds the buyer with _ETHSupplyForBuyer, _ERC20SupplyForBuyer
  // then builds the signature by the operator,
  // and the buyer relays the payment and provides funds.
  async function bid(_bidData, _ERC20SupplyForBuyer, _ETHSupplyForBuyer) {
    // Prepare bidder: fund her with ERC20 & ETH
    await erc20.transfer(_bidData.bidder, _ERC20SupplyForBuyer, { from: deployer });
    await provideFunds(deployer, _bidData.bidder, _ETHSupplyForBuyer);

    // Buyer approves purchase allowance
    await erc20.approve(payments.address, _bidData.bidAmount, { from: _bidData.bidder }).should.be.fulfilled;

    // Operator signs purchase
    const signature = await signEIP712(operatorPrivKey, prepareDataToSignBid, _bidData, true);

    // Pay
    const receipt = await payments.bid(_bidData, signature, { from: _bidData.bidder });
    const gasFee = getGasFee(receipt);
    return { signature, gasFee };
  }

  // eslint-disable-next-line no-unused-vars

  it('setToLocalBalanceOnOutBid sets values correctly and emits events', async () => {
    // default value is false
    const universeId = 3;
    assert.equal(await payments.universeToLocalBalanceOnOutBid(universeId), false);

    await payments.setToLocalBalanceOnOutBid(universeId, true);
    assert.equal(await payments.universeToLocalBalanceOnOutBid(universeId), true);

    await payments.setToLocalBalanceOnOutBid(universeId, false);
    assert.equal(await payments.universeToLocalBalanceOnOutBid(universeId), false);

    const past = await payments.getPastEvents('ToLocalBalanceOnOutBid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past.length, 2);
    assert.equal(past[0].args.toLocalBalanceOnOutBid, true);
    assert.equal(past[1].args.toLocalBalanceOnOutBid, false);
  });

  it('bid: relayed operator sig must correspond to actual operator', async () => {
    assert.notEqual(operator, carol);
    await payments.setUniverseOperator(bidData.universeId, carol);
    assert.equal(await payments.universeOperator(bidData.universeId), carol);
    await truffleAssert.reverts(
      bid(bidData, initialBuyerERC20, initialBuyerETH),
      'incorrect operator signature.',
    );
  });

  it('relayedBid: the actual operator must sign relay bid signed by bidder', async () => {
    assert.notEqual(operator, carol);
    await payments.setUniverseOperator(bidData.universeId, carol);
    assert.equal(await payments.universeOperator(bidData.universeId), carol);
    await truffleAssert.reverts(
      relayedBid(bidData, initialBuyerERC20, initialBuyerETH),
      'incorrect operator signature',
    );
  });

  it('bidder must sign the relayed bid data', async () => {
    await erc20.transfer(bidData.bidder, initialBuyerERC20, { from: deployer });
    await provideFunds(deployer, bidData.bidder, initialBuyerETH);

    await erc20.approve(payments.address, bidData.bidAmount, { from: bidData.bidder }).should.be.fulfilled;

    // Buyer signs purchase
    const randomPK = '0x9A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
    const signatureOperator = await signEIP712(operatorPrivKey, prepareDataToSignBid, bidData, true);
    const signatureRnd = await signEIP712(randomPK, prepareDataToSignBid, bidData, true);
    // Pay
    await truffleAssert.reverts(
      payments.relayedBid(bidData, signatureRnd, signatureOperator, { from: bob }),
      'incorrect bidder signature.',
    );
  });

  it('endsAt cannot be null', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.endsAt = 0;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerERC20, initialBuyerETH),
      'endsAt cannot be in the past.',
    );
  });

  it('AUCTIONING moves to ASSET TRANSFERRING after endsAt', async () => {
    await bid(bidData, initialBuyerERC20, initialBuyerETH);
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
    await bid(bidData0, initialBuyerERC20, initialBuyerETH);

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
    await bid(bidData0, initialBuyerERC20, initialBuyerETH);
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
    assert.equal(Number(await payments.universeExtendableBy(bidData.universeId)), extendableBy);

    await truffleAssert.reverts(
      bid(bidData, initialBuyerERC20, initialBuyerETH),
      'cannot start auction that is extendable too close to expiration time',
    );

    extendableBy = paymentWindow - 3600 * 2 + 1;
    await payments.setDefaultAuctionConfig(1, 1, extendableBy);
    await truffleAssert.reverts(
      bid(bidData, initialBuyerERC20, initialBuyerETH),
      'cannot start auction that is extendable too close to expiration time',
    );

    extendableBy = paymentWindow - 3600 * 2 - 1;
    await payments.setDefaultAuctionConfig(1, 1, extendableBy);
    await bid(bidData, initialBuyerERC20, initialBuyerETH).should.be.fulfilled;
  });
});
