/* eslint-disable no-underscore-dangle */
/* eslint-disable max-len */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-undef */

const { assert } = require('chai');
const truffleAssert = require('truffle-assertions');
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBid, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const {
  fromHexString, toBN, provideFunds, registerAccountInLocalTestnet, getGasFee, assertBalances, addressFromPk, generateSellerSig,
} = require('../helpers/utils');
const { TimeTravel } = require('../helpers/TimeTravel');

require('chai')
  .use(require('chai-as-promised'))
  .should();

const MyToken = artifacts.require('MyToken');
const EIP712Verifier = artifacts.require('EIP712VerifierAuction');
const AuctionERC20 = artifacts.require('AuctionERC20');

contract('AuctionERC20_1', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const defaultMinPercent = 500; // 5%
  const defaultTimeToExtend = 10 * 60; // 10 min
  const defaultExtendableBy = 24 * 3600; // 1 day
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
  const minimalSupply = Math.round(Number(initialBuyerETH) / 10);

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
    await registerAccountInLocalTestnet(sellerAccount).should.be.fulfilled;
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

  async function finalize(_paymentId, _success, _operatorPvk) {
    const data = { paymentId: _paymentId, wasSuccessful: _success };
    const signature = await signEIP712(_operatorPvk, prepareDataToSignAssetTransfer, data, true);
    await payments.finalize(
      data,
      signature,
    );
  }

  // Executes a relayedBid. Reused by many tests.
  // It first funds the buyer, then buyer approves, signs, and the operator relays the payment.
  async function relayedBid(_sellerPrivKey, _bidData, _ERC20SupplyForBuyer, _ETHSupplyForBuyer, _bidderPK) {
    // Prepare buyerAccount.address to be a buyer: fund her with ERC20, with ETH
    await erc20.transfer(_bidData.bidder, _ERC20SupplyForBuyer, { from: deployer });
    await provideFunds(deployer, _bidData.bidder, _ETHSupplyForBuyer);

    // Buyer approves purchase allowance
    await erc20.approve(payments.address, _bidData.bidAmount, { from: _bidData.bidder }).should.be.fulfilled;

    // Buyer signs purchase
    const bidderPK = _bidderPK || buyerPrivKey;
    const sigBidder = await signEIP712(bidderPK, prepareDataToSignBid, _bidData, true);
    const sigOperator = await signEIP712(operatorPrivKey, prepareDataToSignBid, _bidData, true);
    const sigSeller = generateSellerSig(_sellerPrivKey, _bidData.paymentId);
    // Pay
    await payments.relayedBid(_bidData, sigBidder, sigOperator, sigSeller, { from: operator });
  }

  // Executes a Bid directly by buyer. Reused by many tests.
  // It first funds the buyer with _ETHSupplyForBuyer, _ERC20SupplyForBuyer
  // then builds the signature by the operator,
  // and the buyer relays the payment and provides funds.
  async function bid(_sellerPrivKey, _bidData, _ERC20SupplyForBuyer, _ETHSupplyForBuyer) {
    // Prepare bidder: fund her with ERC20 & ETH
    await erc20.transfer(_bidData.bidder, _ERC20SupplyForBuyer, { from: deployer });
    await provideFunds(deployer, _bidData.bidder, _ETHSupplyForBuyer);

    // Buyer approves purchase allowance
    await erc20.approve(payments.address, _bidData.bidAmount, { from: _bidData.bidder }).should.be.fulfilled;

    // Operator signs purchase
    const signature = await signEIP712(operatorPrivKey, prepareDataToSignBid, _bidData, true);
    const sigSeller = generateSellerSig(_sellerPrivKey, _bidData.paymentId);
    // Pay
    const receipt = await payments.bid(_bidData, signature, sigSeller, { from: _bidData.bidder });
    const gasFee = getGasFee(receipt);
    return { signature, gasFee };
  }

  // eslint-disable-next-line no-unused-vars
  it('can query optional ERC20 name, symbol and decimals on deploy', async () => {
    assert.equal(await payments.erc20ContractName(), name);
    assert.equal(await payments.erc20ContractSymbol(), symbol);
    assert.equal(Number(await payments.erc20ContractDecimals()), 18);
  });

  it('Bid execution results in funds received by Payments contract', async () => {
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    assert.equal(Number(await erc20.balanceOf(payments.address)), bidData.bidAmount);
  });

  it('Bid execution results in funds received by Payments contract (relayed)', async () => {
    await relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    assert.equal(Number(await erc20.balanceOf(payments.address)), bidData.bidAmount);
  });

  it('Bid execution fails if deadline to bid expired', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('Bid execution fails if deadline to bid expired (relayed)', async () => {
    await timeTravel.wait(timeToPay + 10);
    await truffleAssert.reverts(
      relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH),
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
      AuctionERC20.new(
        erc20.address,
        CURRENCY_DESCRIPTOR,
        eip712.address,
        0,
        defaultTimeToExtend,
        defaultExtendableBy,
      ),
      'minIncreasePercentage must be non-zero',
    );
  });

  it('Cannot set too large extendableBy', async () => {
    const maxExtendableBy = Number(await payments._MAX_EXTENDABLE_BY());
    assert.equal(maxExtendableBy, 2 * 24 * 3600);

    // reverts on set default
    await truffleAssert.reverts(
      payments.setDefaultAuctionConfig(defaultMinPercent, defaultTimeToExtend, maxExtendableBy + 1),
      'extendableBy exceeds maximum allowed',
    );
    // reverts on set universe specific
    const universeId = 12;
    await truffleAssert.reverts(
      payments.setUniverseAuctionConfig(universeId, defaultMinPercent, defaultTimeToExtend, maxExtendableBy + 1),
      'extendableBy exceeds maximum allowed',
    );
    // reverts on deploy
    await truffleAssert.fails(
      AuctionERC20.new(
        erc20.address,
        CURRENCY_DESCRIPTOR,
        eip712.address,
        defaultMinPercent,
        defaultTimeToExtend,
        maxExtendableBy + 1,
      ),
      'extendableBy exceeds maximum allowed',
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
    assert.equal(await payments.universeMinIncreasePercentage(universeId), newMin);
    assert.equal(await payments.universeTimeToExtend(universeId), newTime);
    assert.equal(await payments.universeExtendableBy(universeId), newExtendable);
  });

  it('Bid emits correct event', async () => {
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    const past = await payments.getPastEvents('Bid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
    assert.equal(past[0].args.bidder, bidData.bidder);
    assert.equal(past[0].args.seller, bidData.seller);
    assert.equal(past[0].args.bidAmount, bidData.bidAmount);
    assert.equal(past[0].args.endsAt, bidData.endsAt);
  });

  it('Bid emits correct event (relayed)', async () => {
    await relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    const past = await payments.getPastEvents('Bid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
    assert.equal(past[0].args.bidder, bidData.bidder);
    assert.equal(past[0].args.seller, bidData.seller);
    assert.equal(past[0].args.bidAmount, bidData.bidAmount);
    assert.equal(past[0].args.endsAt, bidData.endsAt);
  });

  it('Bid info is stored correctly if bid takes place before the last minutes', async () => {
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

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

  it('Bid info is stored correctly if bid takes place before the last minutes (relayed)', async () => {
    await relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

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
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    await timeTravel.waitUntil(endsAt - 30);
    assert.equal(await payments.paymentState(bidData.paymentId), AUCTIONING);

    await timeTravel.wait(40);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('AUCTIONING moves to ASSET_TRANSFERRING after endsAt (relayed)', async () => {
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
    await bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);
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
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state.',
    );
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey).should.be.fulfilled;
  });

  it('finalize must be called by the latest available operator, not the one in the original payment', async () => {
    // create bid with initial operator
    const initialOperator = await payments.universeOperator(bidData.universeId);
    assert.equal(initialOperator, operator);
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    // change operator:
    await payments.setUniverseOperator(bidData.universeId, bidData.bidder);
    assert.equal(await payments.universeOperator(bidData.universeId), bidData.bidder);

    // should fail: try to finalize with initial operator
    await timeTravel.waitUntil(endsAt + 30);
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'only the operator can sign an assetTransferResult',
    );

    // should work: finalize with current operator
    await finalize(bidData.paymentId, true, buyerPrivKey).should.be.fulfilled;
  });

  it('Test splitFundingSources with non-zero local balance', async () => {
    // First complete a sell, so that seller has local balance
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'bid amount cannot be 0.',
    );
  });

  it('assertBuyNowInputsOK fails on bad fees value', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.feeBPS = 10001;
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'fee cannot be larger than maxFeeBPS',
    );
  });

  it('assertBuyNowInputsOK fails on expired deadline', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.deadline = 1;
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'payment deadline expired',
    );
  });

  it('enoughFundsAvailable by using part in local balance', async () => {
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);

    const sellerInitBalance = await erc20.balanceOf(bidData.seller);

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
    // - first fund:
    await erc20.transfer(bidData.seller, extraNeeded, { from: deployer });
    assert.equal(await payments.enoughFundsAvailable(bidData.seller, bidAmount), false);

    // - then approve the usage of those funds:
    await provideFunds(deployer, bidData.seller, minimalSupply);
    await erc20.approve(payments.address, extraNeeded, { from: bidData.seller });
    assert.equal(await payments.enoughFundsAvailable(bidData.seller, bidAmount), true);
  });

  it('Operator cannot coincide with bidder', async () => {
    // Prepare bidData where the buyer coincides with the operator:
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = operator;

    // Bid fails
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'operator must be an observer',
    );
  });

  it('Operator cannot coincide with seller', async () => {
    // Prepare bidData where the buyer coincides with the operator:
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.seller = operator;

    // Bid fails
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'operator must be an observer',
    );
  });

  it('Bidder cannot coincide with seller', async () => {
    // Prepare bidData where the buyer coincides with the operator:
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.seller = bidData.bidder;

    // Bid fails
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'buyer and seller cannot coincide',
    );
  });
});
