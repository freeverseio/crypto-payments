/* eslint-disable max-len */
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

contract('AuctionNative2', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const defaultMinPercent = 500; // 5%
  const notEnoughPercent = 1.04; // 4%
  const enoughPercent = 1.06; // 6%
  const defaultTimeToExtend = 10 * 60; // 10 min
  const defaultExtendableBy = 24 * 3600; // 1 day
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
  const endsAt = now + 3600; // in one hour
  const deadline = now + timeToPay;
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
    await payments.setUniverseFeesCollector(
      bidData.universeId,
      feesCollector,
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
    const receipt = await payments.bid(_bidData, signature, { from: _bidData.bidder, value });
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
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(bidData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(bidData.bidder));
    const expectedNativeOperator = toBN(await web3.eth.getBalance(operator));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from native coin balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await bid(bidData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(bidData.bidAmount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the external balance
    // But the balances in the payments contract reflect the
    // expected seller and feesCollector amounts for later withdrawals
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(bidData.paymentId), PAID);

    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const sellerAmount = Number(bidData.bidAmount) - feeAmount;

    expectedPaymentsSeller = toBN(sellerAmount);
    expectedPaymentsFeesCollector = toBN(feeAmount);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the funds have gone from buyer to seller fully in the external balance
    let receipt = await payments.withdraw({ from: bidData.seller }).should.be.fulfilled;
    let fee = getGasFee(receipt);

    expectedPaymentsSeller = toBN(0);
    expectedNativeSeller.iadd(toBN(sellerAmount - fee));

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, operator],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the external balances
    receipt = await payments.withdraw({ from: feesCollector }).should.be.fulfilled;
    fee = getGasFee(receipt);

    expectedPaymentsFeesCollector = toBN(0);
    expectedNativeFeesCollector.iadd(toBN(feeAmount - fee));

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeOperator, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('Repeated payments lead to addition of funds', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.paymentId = '0xa884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';

    const paymentData3 = JSON.parse(JSON.stringify(bidData));
    paymentData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    paymentData3.seller = bob;

    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    const expectedNativeSeller = toBN(await web3.eth.getBalance(bidData.seller));
    const expectedNativeBob = toBN(await web3.eth.getBalance(bob));

    // We will do 2 payments with equal seller, and 1 with a different seller (Bob)
    await bid(bidData, initialBuyerETH);
    await bid(bidData2, initialBuyerETH);
    await bid(paymentData3, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    await finalize(bidData2.paymentId, true, operatorPrivKey);
    await finalize(paymentData3.paymentId, true, operatorPrivKey);

    const fee1 = getGasFee(await payments.withdraw({ from: feesCollector }));
    const fee2 = getGasFee(await payments.withdraw({ from: bidData.seller }));
    const fee3 = getGasFee(await payments.withdraw({ from: bob }));

    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const sellerAmount = Number(bidData.bidAmount) - feeAmount;

    // the feescollector has collected 3 fees
    expectedNativeFeesCollector.iadd(toBN(3 * feeAmount - fee1));
    expectedNativeSeller.iadd(toBN(2 * sellerAmount - fee2));
    expectedNativeBob.iadd(toBN(sellerAmount - fee3));

    await assertBalances(
      'native',
      [bidData.seller, bob, feesCollector],
      [expectedNativeSeller, expectedNativeBob, expectedNativeFeesCollector],
    );
  });

  it('Repeated bids result in funds remaining in local Balance', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = bob;
    bidData2.bidAmount = Number(bidData.bidAmount) + 123;

    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    const expectedNativeSeller = toBN(await web3.eth.getBalance(bidData.seller));
    const expectedNativeBidder1 = toBN(await web3.eth.getBalance(bidData.bidder));
    const expectedNativeBidder2 = toBN(await web3.eth.getBalance(bidData2.bidder));
    const expectedNativeContract = toBN(0);

    await assertBalances(
      'native',
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedNativeContract, expectedNativeSeller, expectedNativeBidder1, expectedNativeBidder2, expectedNativeFeesCollector],
    );

    const { gasFee } = await bid(bidData, initialBuyerETH);

    expectedNativeBidder1.iadd(toBN(initialBuyerETH - bidData.bidAmount)).isub(gasFee);
    expectedNativeContract.iadd(toBN(bidData.bidAmount));

    await assertBalances(
      'native',
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedNativeContract, expectedNativeSeller, expectedNativeBidder1, expectedNativeBidder2, expectedNativeFeesCollector],
    );

    const { gasFee: gasFee2 } = await bid(bidData2, 0);

    expectedNativeBidder2.isub(toBN(bidData2.bidAmount)).isub(gasFee2);
    expectedNativeContract.iadd(toBN(bidData2.bidAmount));

    await assertBalances(
      'native',
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedNativeContract, expectedNativeSeller, expectedNativeBidder1, expectedNativeBidder2, expectedNativeFeesCollector],
    );

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);

    const feeAmount = Math.floor((Number(bidData2.bidAmount) * bidData2.feeBPS) / 10000);

    const expectedLocalSeller = toBN(bidData2.bidAmount - feeAmount);
    const expectedLocalBidder1 = toBN(bidData.bidAmount);
    const expectedLocalBidder2 = toBN(0);
    const expectedLocalFeesCollector = toBN(feeAmount);

    await assertBalances(
      payments,
      [bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedLocalSeller, expectedLocalBidder1, expectedLocalBidder2, expectedLocalFeesCollector],
    );
  });

  it('Balances are as expected when same bidder bids higher', async () => {
    const thisBidder = bidData.bidder;

    // We first let the bidder sell, so as to have non-zero local balance
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.seller = thisBidder;
    bidData2.bidder = carol;

    await bid(bidData2, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData2.paymentId, true, operatorPrivKey);

    // The buyer now has funds equal to sold asset, minus fees
    const feeAmount = Math.floor(Number(bidData2.bidAmount) * bidData2.feeBPS) / 10000;
    const expectedBidderLocalBalance = toBN(bidData2.bidAmount - feeAmount);
    assert.equal(Number(expectedBidderLocalBalance), 285);

    await assertBalances(
      payments,
      [thisBidder],
      [expectedBidderLocalBalance],
    );

    // The contract holds the exact bidAmount (300), of which fees can be withdraw by operator,
    // and the rest, by the bidder. The bidder still has no funds outside the contract.
    const expectedContractFunds = toBN(bidData2.bidAmount);
    const expectedBidderExternalFunds = toBN(0);
    await assertBalances(
      'native',
      [payments.address, thisBidder],
      [expectedContractFunds, expectedBidderExternalFunds],
    );

    // The bidder now engages in the first bid for her, starting a new auction
    const bidData3 = JSON.parse(JSON.stringify(bidData));
    bidData3.endsAt = bidData.endsAt + 24 * 3600;
    bidData3.bidAmount = 10;
    bidData3.paymentId = '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee06';

    // all funds shall come from local balance:
    const split = await payments.splitAuctionFundingSources(bidData3);
    assert.equal(split.localFunds, bidData3.bidAmount);
    assert.equal(split.externalFunds, 0);
    assert.equal(split.isSameBidder, false);

    // bidder is able to bid without adding new funds
    const { gasFee: gasFee1 } = await bid(bidData3, initialBuyerETH, 0);

    // bidder just notices that there are less funds to withdraw
    expectedBidderLocalBalance.isub(toBN(bidData3.bidAmount));
    assert.equal(Number(expectedBidderLocalBalance), 285 - 10);
    await assertBalances(
      payments,
      [thisBidder],
      [expectedBidderLocalBalance],
    );

    // bidder outbids her own bid:
    const bidData4 = JSON.parse(JSON.stringify(bidData3));
    bidData4.bidAmount = 300;

    // the outbid is by 300 (newBid) - 10 (prevBid) = 290.
    // since bidder already has 275 in the local balance,
    // she needs to provide only 290 - 275 = 15
    const { gasFee: gasFee2 } = await bid(bidData4, 0, 15);

    // local balance of bidder is now 0
    expectedBidderLocalBalance.isub(expectedBidderLocalBalance);
    assert.equal(Number(expectedBidderLocalBalance), 0);
    await assertBalances(
      payments,
      [thisBidder],
      [expectedBidderLocalBalance],
    );

    // while the contract now holds:
    expectedContractFunds.iadd(toBN(15));
    expectedBidderExternalFunds.iadd(toBN(initialBuyerETH)).isub(toBN(15).iadd(gasFee1).iadd(gasFee2));
    await assertBalances(
      'native',
      [payments.address, thisBidder],
      [expectedContractFunds, expectedBidderExternalFunds],
    );
    assert.equal(Number(expectedContractFunds), 315);

    // finalize:
    await timeTravel.waitUntil(bidData4.endsAt + 30);
    await finalize(bidData4.paymentId, true, operatorPrivKey);

    // the contract holds 315, of which:
    // - fees: 15 from first auction, 15 from second auction
    // - 285 withdrawable by last seller, since buyer spent it all:
    const expectedSellerLocalFunds = toBN(285);
    const expectedFeesCollectorLocalFunds = toBN(30);
    assert.equal(285 + 30, 315);
    await assertBalances(
      payments,
      [bidData4.seller, feesCollector],
      [expectedSellerLocalFunds, expectedFeesCollectorLocalFunds],
    );
  });

  it('Bids after the first bid need to have coherent feeBPS and endsAt', async () => {
    const bidData0 = JSON.parse(JSON.stringify(bidData));
    bidData0.bidAmount = 100;

    await bid(bidData0, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData0.paymentId), AUCTIONING);

    const bidData2 = JSON.parse(JSON.stringify(bidData0));
    const bidIncrease = 2 * Number(bidData2.bidAmount);
    bidData2.bidAmount += bidIncrease;

    // Try to place another bid with non-agreed feeBPS
    bidData2.feeBPS = 4132;
    await truffleAssert.reverts(
      bid(bidData2, 0, bidIncrease),
      'fee does not match on-going auction fee.',
    );

    // Try to place another bid with endsAt beyond extendableBy
    bidData2.feeBPS = bidData0.feeBPS;
    bidData2.endsAt = bidData0.endsAt + defaultExtendableBy + 1;
    await truffleAssert.reverts(
      bid(bidData2, 0, bidIncrease),
      'endsAt does not correspond to on-going auction data',
    );

    // restoring default data works well:
    bidData2.endsAt = bidData0.endsAt;
    await bid(bidData2, 0, bidIncrease);
  });

  it('If Bidder increases own bid, only the diff needed must be provided', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidAmount = Math.floor(enoughPercent * bidData.bidAmount);
    const newFundsNeeded = bidData2.bidAmount - bidData.bidAmount;

    // Cannot provide more than bidAmount
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH, bidData2.bidAmount + 1),
      'new funds provided must be less than bid amount',
    );
    // Cannot provide less than required
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH, newFundsNeeded - 1),
      'new funds provided are not within required range',
    );

    // possible to pay just the bare minimum, with no localBalance afterwards:
    const snapshot2 = await timeTravel.takeSnapshot();
    await bid(bidData2, initialBuyerETH, newFundsNeeded);
    await assertBalances(
      payments,
      [bidData2.bidder],
      [toBN(0)],
    );
    await timeTravel.revertToSnapShot(snapshot2.result);

    // possible to pay some excess, with local balance afterwards
    await bid(bidData2, initialBuyerETH, newFundsNeeded + 22);
    await assertBalances(
      payments,
      [bidData2.bidder],
      [toBN(22)],
    );
  });

  it('Bid must be some percentage larger than previous highest bid', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);

    // try to bid again
    await truffleAssert.reverts(
      bid(bidData, initialBuyerETH),
      'bid needs to be larger than previous bid by a certain percentage.',
    );
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = carol;
    bidData2.bidAmount = Math.floor(notEnoughPercent * bidData.bidAmount);
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'bid needs to be larger than previous bid by a certain percentage.',
    );
    bidData2.bidAmount = Math.floor(enoughPercent * bidData.bidAmount);
    await bid(bidData2, initialBuyerETH);
  });

  it('From PAID: no further action is accepted', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    // try assetTransferSuccess
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try assetTransferFails
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    // try to bid again
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = operatorAccount.address;
    bidData2.bidAmount = Math.floor(enoughPercent * bidData.bidAmount);
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'bids are only accepted if state is either NOT_STARTED or AUCTIONING',
    );
  });

  it('From ASSET_TRANSFER: buyer is refunded when asset transfer fails', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    const expectedNativeSeller = toBN(await web3.eth.getBalance(bidData.seller));
    const expectedNativeBuyer = toBN(await web3.eth.getBalance(bidData.bidder));
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));
    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the external balance
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await bid(bidData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(bidData.bidAmount))
      .isub(gasFee);

    // When payment moves to REFUNDED, balances have been updated with buyer's refund:
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);

    // Check BuyerRefund event:
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
    assert.equal(past[0].args.buyer, bidData.bidder);

    expectedPaymentsBuyer.iadd(toBN(bidData.bidAmount));

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdrawal, she sees the tokens back in the external balance
    const fee = getGasFee(await payments.withdraw({ from: bidData.bidder }));

    // Check withdraw event:
    const past2 = await payments.getPastEvents('Withdraw', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past2[0].args.user, bidData.bidder);
    assert.equal(past2[0].args.amount, bidData.bidAmount);

    expectedNativeBuyer.iadd(toBN(bidData.bidAmount - fee));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('From auction ended: buyer can refund after paymentWindow passed', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.

    const expectedNativeSeller = toBN(await web3.eth.getBalance(bidData.seller));
    const expectedNativeBuyer = toBN(0);
    const expectedNativeFeesCollector = toBN(await web3.eth.getBalance(feesCollector));

    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the external balance
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    const { gasFee } = await bid(bidData, initialBuyerETH);

    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(bidData.bidAmount))
      .isub(gasFee);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    // Let's move to right after the auction finishes.
    // At this stage, noone can (still) refund without the signed assetTransferResult
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.refund(bidData.paymentId, { from: bob }),
      'payment does not accept refunds at this stage',
    );

    // Let's move to FAILED implicitly, by going beyond expiration time:
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.waitUntil(endsAt + Number(paymentWindow) + 10);

    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // note that anyone can do this, not necessarily the interested party:
    await payments.refund(bidData.paymentId, { from: bob }).should.be.fulfilled;

    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);

    // only the samll unused amount should remain as local balance
    expectedPaymentsBuyer = toBN(bidData.bidAmount);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdraw, buyer sees the tokens back in the external balance
    const receipt = await payments.withdraw({ from: bidData.bidder });
    const fee = getGasFee(receipt);

    expectedNativeBuyer.iadd(toBN(bidData.bidAmount - fee));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      'native',
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedNativeBuyer, expectedNativeSeller, expectedNativeFeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('finalize: only operator is authorized to sign', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
    await truffleAssert.reverts(
      finalize(bidData.paymentId, false, buyerPrivKey),
      'only the operator can sign an assetTransferResult',
    );
  });

  it('ASSET_TRANSFERRING moves to PAID when someone relays operator confirmation of asset transfer success', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    assert.equal(await payments.paymentState(bidData.paymentId), PAID);

    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const sellerAmount = Number(bidData.bidAmount) - feeAmount;

    await assertBalances(
      payments,
      [bidData.seller, feesCollector],
      [sellerAmount, feeAmount],
    );

    // Check PAY event
    const past = await payments.getPastEvents('Paid', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
  });

  it('ASSET_TRANSFERRING moves to REFUNDED when someone realays operator confirmation of asset transfer failed', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await finalize(bidData.paymentId, false, operatorPrivKey);
    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);

    // check event
    const past = await payments.getPastEvents('BuyerRefunded', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past[0].args.paymentId, bidData.paymentId);
    assert.equal(past[0].args.buyer, bidData.bidder);
  });

  it('From NOT_STARTED: not possible to confirm asset transfer failure or success', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    assert.equal(await payments.paymentState(bidData.paymentId), NOT_STARTED);

    // Fails to recognize operator because all bidData have been deleted
    await truffleAssert.reverts(
      finalize(bidData.paymentId, true, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
    await truffleAssert.reverts(
      finalize(bidData.paymentId, false, operatorPrivKey),
      'payment not initially in asset transferring state',
    );
  });

  it('ASSET_TRANSFERRING allows ACCEPTS_REFUND after expiration time', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // wait just before expiration time, and check that state has not changed yet
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.waitUntil(endsAt + Number(paymentWindow) - 100);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), false);

    // wait the remainder period to get beyond expiration time,
    await timeTravel.wait(101);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), true);
    // note that the written state has not changed, though:
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('ACCEPTS_REFUNDS: anyone can refundAndWithdraw in one transaction if allowed', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    const expectedNativeBuyer = toBN(await web3.eth.getBalance(bidData.bidder));

    const { gasFee } = await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // wait beyond payment window to move to FAILED
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.wait(Number(paymentWindow) + 5);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), true);
    // Check expected external balance of buyer before refunding:
    expectedNativeBuyer.iadd(toBN(initialBuyerETH))
      .isub(toBN(bidData.bidAmount))
      .isub(gasFee);

    await assertBalances('native', [bidData.bidder], [expectedNativeBuyer]);

    // Anyone can execute refundAndWithdraw because bidder has not declared otherwise
    assert.equal(await payments.onlyUserCanWithdraw(bidData.bidder), false);
    await payments.refundAndWithdraw(bidData.paymentId, { from: bob });

    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);
    // After refundAndWithdraw: no balance in payments contract, all funds refunded
    expectedNativeBuyer.iadd(toBN(bidData.bidAmount));
    await assertBalances(payments, [bidData.bidder], [0]);
    await assertBalances('native', [bidData.bidder], [expectedNativeBuyer]);
  });

  it('ASSET_TRANSFERRING blocks another Bid', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = operatorAccount.address;
    bidData2.bidAmount = 2 * bidData.bidAmount;
    await truffleAssert.reverts(
      bid(bidData2, initialBuyerETH),
      'bids are only accepted if state is either NOT_STARTED or AUCTIONING',
    );
  });

  it('ASSET_TRANSFERRING blocks refund', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(bidData, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.refund(bidData.paymentId),
      'payment does not accept refunds at this stage',
    );
  });

  it('if isSellerRegistrationRequired == false, no need to register', async () => {
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    await provideFunds(deployer, bidData.bidder, initialBuyerETH);

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBid({
        msg: bidData,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    // fails unless registration is not required:
    assert.equal(await payments.isRegisteredSeller(bidData.seller), false);
    await truffleAssert.reverts(
      payments.bid(bidData, signature, { from: bidData.bidder, value: bidData.bidAmount }),
      'seller not registered',
    );
    await payments.setIsSellerRegistrationRequired(false, { from: deployer }).should.be.fulfilled;
    await payments.bid(bidData, signature, { from: bidData.bidder, value: bidData.bidAmount }).should.be.fulfilled;
  });

  it('Bid requirements are correctly checked', async () => {
    // This test checks the fulfillment of all requirements to accept a payment
    // By starting with not fulfilling any, checking revert messages, then
    // fulfilling one & checking new revert message, etc., until accepted.
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidAmount = String(initialBuyerETH + 123);

    // Carol will be the buyer:
    assert.equal(bidData2.bidder, buyerAccount.address);
    // And also funding Carol with ETH so that she can approve
    await provideFunds(deployer, bidData2.bidder, initialBuyerETH);

    // should fail unless the buyer is the sender of the TX
    await truffleAssert.reverts(
      payments.bid(bidData2, dummySignature, { from: operator, value: bidData2.bidAmount }),
      'only bidder can execute this function',
    );

    await truffleAssert.fails(
      payments.bid(bidData2, dummySignature, { from: bidData2.bidder, value: bidData2.bidAmount }),
      'incorrect operator signature',
    );

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(operatorPrivKey.slice(2)),
      prepareDataToSignBid({
        msg: bidData2,
        chainId: await web3.eth.getChainId(),
        contractAddress: eip712.address,
      }),
    );

    // should fail due to not enough funds
    await truffleAssert.fails(
      payments.bid(bidData2, signature, { from: bidData2.bidder, value: bidData2.bidAmount }),
      'seller not registered',
    );

    await payments.registerAsSeller({ from: bidData2.seller }).should.be.fulfilled;

    // fails unless fee is below 100%
    const wrongPaymentData2 = JSON.parse(JSON.stringify(bidData2));
    wrongPaymentData2.feeBPS = 10100;
    await truffleAssert.fails(
      bid(wrongPaymentData2, 0),
      'fee cannot be larger than 100 percent',
    );

    // fails due to insufficient funds:
    await payments.bid(bidData2, signature, { from: bidData2.bidder, value: bidData2.bidAmount }).should.be.rejected;

    await provideFunds(deployer, bidData2.bidder, initialBuyerETH);

    // it finally is accepted
    await payments.bid(bidData2, signature, { from: bidData2.bidder, value: bidData2.bidAmount }).should.be.fulfilled;
  });
});
