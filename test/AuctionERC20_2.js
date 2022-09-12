/* eslint-disable max-len */
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

contract('AuctionERC20_2', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};
  const CURRENCY_DESCRIPTOR = 'SUPER COIN';
  const defaultMinPercent = 500; // 5%
  const notEnoughPercent = 1.04; // 4%
  const enoughPercent = 1.06; // 6%
  const defaultTimeToExtend = 10 * 60; // 10 min
  const defaultExtendableBy = 24 * 3600; // 1 day
  const [deployer, aliceSister, bobSister, carol] = accounts;
  const feesCollector = carol;
  const sellerPrivKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
  const buyerPrivKey = '0x3B878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const operatorPrivKey = '0x4A878F7892FBBFA30C8AED1DF317C19B853685E707C2CF0EE1927DC516060A54';
  const bobPrivKey = '0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52';
  const sellerAccount = web3.eth.accounts.privateKeyToAccount(sellerPrivKey);
  const buyerAccount = web3.eth.accounts.privateKeyToAccount(buyerPrivKey);
  const operatorAccount = web3.eth.accounts.privateKeyToAccount(operatorPrivKey);
  const bobAccount = web3.eth.accounts.privateKeyToAccount(bobPrivKey);
  const alice = sellerAccount.address;
  const bob = bobAccount.address;
  const operator = operatorAccount.address;
  const name = 'MYERC20';
  const symbol = 'FV20';
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
    await registerAccountInLocalTestnet(bobAccount).should.be.fulfilled;
    await erc20.transfer(operator, initialOperatorERC20, { from: deployer });
    await provideFunds(deployer, operator, initialOperatorETH);
    await provideFunds(deployer, bob, minimalSupply);
    await provideFunds(deployer, bidData.seller, minimalSupply);
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

    // Pay
    const sigSeller = generateSellerSig(_sellerPrivKey, _bidData.paymentId);
    const receipt = await payments.bid(_bidData, signature, sigSeller, { from: _bidData.bidder });
    const gasFee = getGasFee(receipt);
    return { signature, gasFee };
  }

  it('From PAID: seller can withdraw, all balances work as expected', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    // - ERC20 contract:
    const expectedERC20Buyer = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20Operator = await erc20.balanceOf(operator);
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the bidAmount has been subtracted from external balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the ERC20 contract
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
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the ERC20 have gone from buyer to seller fully in the ERC20 contract
    await payments.withdraw({ from: bidData.seller }).should.be.fulfilled;

    expectedPaymentsSeller = toBN(0);
    expectedERC20Seller.iadd(toBN(sellerAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the ERC20 contract.
    await payments.withdraw({ from: feesCollector }).should.be.fulfilled;

    expectedPaymentsFeesCollector = toBN(0);
    expectedERC20FeesCollector.iadd(toBN(feeAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('From PAID: seller can withdraw, all balances work as expected (relayed)', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.
    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    // - ERC20 contract:
    const expectedERC20Buyer = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20Operator = await erc20.balanceOf(operator);
    const expectedERC20FeesCollector = await erc20.balanceOf(feesCollector);
    //
    const expectedPaymentsBuyer = toBN(0);
    let expectedPaymentsSeller = toBN(0);
    let expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the bidAmount has been subtracted from external balances
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      // eslint-disable-next-line max-len
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment moves to PAID, nothing changes in the ERC20 contract
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
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // When seller withdraws her balance in the payments contract
    // the ERC20 have gone from buyer to seller fully in the ERC20 contract
    await payments.withdraw({ from: bidData.seller }).should.be.fulfilled;

    expectedPaymentsSeller = toBN(0);
    expectedERC20Seller.iadd(toBN(sellerAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, feesCollector can withdraw too, leaving zero balances in the payments contract
    // and the expected amounts in the ERC20 contract.
    await payments.withdraw({ from: feesCollector }).should.be.fulfilled;

    expectedPaymentsFeesCollector = toBN(0);
    expectedERC20FeesCollector.iadd(toBN(feeAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, operator, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20Operator, expectedERC20FeesCollector],
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

    const bidData3 = JSON.parse(JSON.stringify(bidData));
    bidData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    bidData3.seller = bob;

    const expectedERC20FeesCollector = toBN(await erc20.balanceOf(feesCollector));
    const expectedERC20Seller = toBN(await erc20.balanceOf(bidData.seller));
    const expectedERC20Bob = toBN(await erc20.balanceOf(bob));

    // We will do 2 payments with equal seller, and 1 with a different seller (Bob)
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);
    await bid(bobPrivKey, bidData3, initialBuyerERC20, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    await finalize(bidData2.paymentId, true, operatorPrivKey);
    await finalize(bidData3.paymentId, true, operatorPrivKey);

    await payments.withdraw({ from: feesCollector });
    await payments.withdraw({ from: bidData.seller });
    await payments.withdraw({ from: bob });

    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const sellerAmount = Number(bidData.bidAmount) - feeAmount;

    // the feescollector has collected 3 fees
    expectedERC20FeesCollector.iadd(toBN(3 * feeAmount));
    expectedERC20Seller.iadd(toBN(2 * sellerAmount));
    expectedERC20Bob.iadd(toBN(sellerAmount));

    await assertBalances(
      erc20,
      [bidData.seller, bob, feesCollector],
      [expectedERC20Seller, expectedERC20Bob, expectedERC20FeesCollector],
    );
  });

  it('Repeated bids result in funds remaining in local Balance if specified explicitly', async () => {
    await payments.setToLocalBalanceOnOutBid(bidData.universeId, true);

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = bob;
    bidData2.bidAmount = Number(bidData.bidAmount) + 123;

    const expectedERC20FeesCollector = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20Bidder1 = toBN(0);
    const expectedERC20Bidder2 = toBN(0);
    const expectedERC20Contract = toBN(0);

    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    assert.equal(initialBuyerERC20, 30000);

    expectedERC20Bidder1.iadd(toBN(initialBuyerERC20 - bidData.bidAmount));
    expectedERC20Contract.iadd(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedERC20Contract, expectedERC20Seller, expectedERC20Bidder1, expectedERC20Bidder2, expectedERC20FeesCollector],
    );

    await bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);

    expectedERC20Bidder2.iadd(toBN(initialBuyerERC20 - bidData2.bidAmount));
    expectedERC20Contract.iadd(toBN(bidData2.bidAmount));

    await assertBalances(
      erc20,
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedERC20Contract, expectedERC20Seller, expectedERC20Bidder1, expectedERC20Bidder2, expectedERC20FeesCollector],
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

  it('Repeated bids result in transfers to external contracts if not specified explicitly', async () => {
    await payments.setToLocalBalanceOnOutBid(bidData.universeId, false);

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = bob;
    bidData2.bidAmount = Number(bidData.bidAmount) + 123;

    const expectedERC20FeesCollector = toBN(0);
    const expectedERC20Seller = toBN(0);
    const expectedERC20Bidder1 = toBN(0);
    const expectedERC20Bidder2 = toBN(0);
    const expectedERC20Contract = toBN(0);

    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    assert.equal(initialBuyerERC20, 30000);

    expectedERC20Bidder1.iadd(toBN(initialBuyerERC20 - bidData.bidAmount));
    expectedERC20Contract.iadd(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedERC20Contract, expectedERC20Seller, expectedERC20Bidder1, expectedERC20Bidder2, expectedERC20FeesCollector],
    );

    await bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);

    expectedERC20Bidder1.iadd(toBN(bidData.bidAmount));
    expectedERC20Bidder2.iadd(toBN(initialBuyerERC20 - bidData2.bidAmount));
    expectedERC20Contract.iadd(toBN(bidData2.bidAmount)).isub(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [payments.address, bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedERC20Contract, expectedERC20Seller, expectedERC20Bidder1, expectedERC20Bidder2, expectedERC20FeesCollector],
    );

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);

    const feeAmount = Math.floor((Number(bidData2.bidAmount) * bidData2.feeBPS) / 10000);

    const expectedLocalSeller = toBN(bidData2.bidAmount - feeAmount);
    const expectedLocalBidder1 = toBN(0);
    const expectedLocalBidder2 = toBN(0);
    const expectedLocalFeesCollector = toBN(feeAmount);

    await assertBalances(
      payments,
      [bidData.seller, bidData.bidder, bidData2.bidder, feesCollector],
      [expectedLocalSeller, expectedLocalBidder1, expectedLocalBidder2, expectedLocalFeesCollector],
    );
  });

  it('Repeated payments lead to addition of funds (relayed)', async () => {
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.paymentId = '0xa884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';

    const bidData3 = JSON.parse(JSON.stringify(bidData));
    bidData3.paymentId = '0xe884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03';
    bidData3.seller = bob;

    const expectedERC20FeesCollector = toBN(await erc20.balanceOf(feesCollector));
    const expectedERC20Seller = toBN(await erc20.balanceOf(bidData.seller));
    const expectedERC20Bob = toBN(await erc20.balanceOf(bob));

    // We will do 2 payments with equal seller, and 1 with a different seller (Bob)
    await relayedBid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await relayedBid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);
    await relayedBid(bobPrivKey, bidData3, initialBuyerERC20, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData.paymentId, true, operatorPrivKey);
    await finalize(bidData2.paymentId, true, operatorPrivKey);
    await finalize(bidData3.paymentId, true, operatorPrivKey);

    await payments.withdraw({ from: feesCollector });
    await payments.withdraw({ from: bidData.seller });
    await payments.withdraw({ from: bob });

    const feeAmount = Math.floor(Number(bidData.bidAmount) * bidData.feeBPS) / 10000;
    const sellerAmount = Number(bidData.bidAmount) - feeAmount;

    // the feescollector has collected 3 fees
    expectedERC20FeesCollector.iadd(toBN(3 * feeAmount));
    expectedERC20Seller.iadd(toBN(2 * sellerAmount));
    expectedERC20Bob.iadd(toBN(sellerAmount));

    await assertBalances(
      erc20,
      [bidData.seller, bob, feesCollector],
      [expectedERC20Seller, expectedERC20Bob, expectedERC20FeesCollector],
    );
  });

  it('Balances are as expected when same bidder bids higher', async () => {
    const thisBidder = bidData.bidder;

    // We first let the bidder sell, so as to have non-zero local balance
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.seller = thisBidder;
    bidData2.bidder = carol;

    await bid(buyerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 30);
    await finalize(bidData2.paymentId, true, operatorPrivKey);

    // The buyer now has funds equal to sold asset, minus fees
    const feeAmount = Math.floor(Number(bidData2.bidAmount) * bidData2.feeBPS) / 10000;
    let expectedBidderLocalBalance = toBN(bidData2.bidAmount - feeAmount);
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
      erc20,
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

    // it is possible to bid even if owning 0 ERC20 outside the contract
    // (the ETH required here is just for gas costs)
    await bid(sellerPrivKey, bidData3, 0, initialBuyerETH);

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
    const outBid = bidData4.bidAmount - bidData3.bidAmount;
    assert.equal(outBid, 290);

    // since bidder already has 275 in the local balance,
    // she needs to provide only 290 - 275 = 15
    await bid(sellerPrivKey, bidData4, 15, 0);

    // local balance of bidder is now 0
    expectedBidderLocalBalance = toBN(0);
    await assertBalances(
      payments,
      [thisBidder],
      [expectedBidderLocalBalance],
    );

    // while the contract now holds:
    expectedContractFunds.iadd(toBN(15));
    // and the bidder holds no external funds
    assert.equal(expectedBidderExternalFunds, 0);
    await assertBalances(
      erc20,
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

  it('Bids after the first bid can have incoherent feeBPS and endsAt (check delegated to L2)', async () => {
    const bidData0 = JSON.parse(JSON.stringify(bidData));
    bidData0.bidAmount = 100;

    await bid(sellerPrivKey, bidData0, initialBuyerERC20, initialBuyerETH);
    assert.equal(await payments.paymentState(bidData0.paymentId), AUCTIONING);

    const bidData2 = JSON.parse(JSON.stringify(bidData0));
    const bidIncrease = 2 * Number(bidData2.bidAmount);
    bidData2.bidAmount += bidIncrease;

    // Try to place another bid with non-agreed feeBPS
    bidData2.feeBPS = 4132;
    await bid(sellerPrivKey, bidData2, bidIncrease, 0).should.be.fulfilled;

    // Try to place another bid with endsAt beyond extendableBy
    bidData2.bidAmount += bidIncrease;
    bidData2.endsAt = bidData0.endsAt + defaultExtendableBy + 1;
    await bid(sellerPrivKey, bidData2, bidIncrease, 0).should.be.fulfilled;
  });

  it('If Bidder increases own bid, only the diff needed must be provided', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, bidData.bidAmount, initialBuyerETH);

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidAmount = Math.floor(enoughPercent * bidData.bidAmount);
    const newFundsNeeded = bidData2.bidAmount - bidData.bidAmount;

    // Cannot provide less than required
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, newFundsNeeded - 1, 0),
      'transfer amount exceeds balance',
    );

    // possible to pay just the bare minimum, with no localBalance afterwards:
    const snapshot2 = await timeTravel.takeSnapshot();
    await bid(sellerPrivKey, bidData2, newFundsNeeded, 0);
    await assertBalances(
      payments,
      [bidData2.bidder],
      [toBN(0)],
    );
    await timeTravel.revertToSnapShot(snapshot2.result);

    // impossible to pay some excess, no local balance left
    await bid(sellerPrivKey, bidData2, newFundsNeeded + 22, 0);
    await assertBalances(
      payments,
      [bidData2.bidder],
      [toBN(0)],
    );
  });

  it('Bid must be some percentage larger than previous highest bid', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    // try to bid again
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH),
      'bid needs to be larger than previous bid by a certain percentage.',
    );
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = carol;
    bidData2.bidAmount = Math.floor(notEnoughPercent * bidData.bidAmount);
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'bid needs to be larger than previous bid by a certain percentage.',
    );
    bidData2.bidAmount = Math.floor(enoughPercent * bidData.bidAmount);
    await bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH);
  });

  it('From PAID: no further action is accepted', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'bids are only accepted if state is either NOT_STARTED or AUCTIONING',
    );
  });

  it('From ASSET_TRANSFER: buyer is refunded when asset transfer fails', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    // This test will check balances of Buyer, Seller & FeesCollector (= deployer)
    // during the various steps of the payment through its 'happy path'.

    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    // - ERC20 contract:
    const expectedERC20Seller = toBN(await erc20.balanceOf(bidData.seller));
    const expectedERC20Buyer = toBN(await erc20.balanceOf(bidData.bidder));
    const expectedERC20FeesCollector = toBN(await erc20.balanceOf(feesCollector));
    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the bidAmount has been subtracted from the ERC20 contract
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));

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
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdrawal, she sees the tokens back in the ERC20 contract
    await payments.withdraw({ from: bidData.bidder });

    // Check withdraw event:
    const past2 = await payments.getPastEvents('Withdraw', { fromBlock: 0, toBlock: 'latest' }).should.be.fulfilled;
    assert.equal(past2[0].args.user, bidData.bidder);
    assert.equal(past2[0].args.amount, bidData.bidAmount);

    expectedERC20Buyer.iadd(toBN(bidData.bidAmount));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
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

    // Initially:
    // - buyer has no balance in ERC20 contract, nor in Payments contract
    // - deployer has some balance in the ERC20 contract.
    const expectedERC20Seller = toBN(await erc20.balanceOf(bidData.seller));
    const expectedERC20Buyer = toBN(0);
    const expectedERC20FeesCollector = toBN(await erc20.balanceOf(feesCollector));

    let expectedPaymentsBuyer = toBN(0);
    const expectedPaymentsSeller = toBN(0);
    const expectedPaymentsFeesCollector = toBN(0);

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // After payment has arrived, the amount has been subtracted from the ERC20 contract
    // in favour of the payments contract address. However, the balances in the
    // payments local address remain 0 until the payment moves to PAID or refunds take place.
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
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
    await timeTravel.waitUntil(endsAt + defaultExtendableBy + Number(paymentWindow) + 10);

    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // note that anyone can do this, not necessarily the interested party:
    await payments.refund(bidData.paymentId, { from: bob }).should.be.fulfilled;

    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);

    // only the small unused amount should remain as local balance
    expectedPaymentsBuyer = toBN(bidData.bidAmount);

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );

    // Finally, after withdraw, buyer sees the tokens back in the ERC20 contract
    await payments.withdraw({ from: bidData.bidder });

    expectedERC20Buyer.iadd(toBN(bidData.bidAmount));
    expectedPaymentsBuyer = toBN(0);

    await assertBalances(
      erc20,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedERC20Buyer, expectedERC20Seller, expectedERC20FeesCollector],
    );

    await assertBalances(
      payments,
      [bidData.bidder, bidData.seller, feesCollector],
      [expectedPaymentsBuyer, expectedPaymentsSeller, expectedPaymentsFeesCollector],
    );
  });

  it('finalize: only operator is authorized to sign', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
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
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);

    await timeTravel.waitUntil(endsAt + 30);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // wait just before expiration time, and check that state has not changed yet
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.waitUntil(endsAt + defaultExtendableBy + Number(paymentWindow) - 100);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), false);

    // wait the remainder period to get beyond expiration time,
    await timeTravel.wait(101);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), true);
    // note that the written state has not changed, though:
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
  });

  it('ACCEPTS_REFUNDS: buyer can refundAndWithdraw in one transaction', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    const expectedERC20Buyer = toBN(await erc20.balanceOf(bidData.bidder));

    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // wait beyond payment window to move to FAILED
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.wait(defaultExtendableBy + Number(paymentWindow) + 5);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), true);
    // Check expected ERC20 of buyer before refunding:
    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));
    await assertBalances(erc20, [bidData.bidder], [expectedERC20Buyer]);

    // If explicitly set by buyer, only he/she can execute refundAndWithdraw
    await payments.setOnlyUserCanWithdraw(true, { from: bidData.bidder }).should.be.fulfilled;
    await truffleAssert.reverts(
      payments.refundAndWithdraw(bidData.paymentId, { from: bob }),
      'tx sender not authorized to withdraw on recipients behalf',
    );

    // The buyer can do it because he has balance right after the refund:
    await payments.refundAndWithdraw(bidData.paymentId, { from: bidData.bidder });

    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);
    // After refundAndWithdraw: no balance in payments contract, all ERC20 refunded
    expectedERC20Buyer.iadd(toBN(bidData.bidAmount));
    await assertBalances(payments, [bidData.bidder], [0]);
    await assertBalances(erc20, [bidData.bidder], [expectedERC20Buyer]);
  });

  it('ACCEPTS_REFUNDS: buyer can refundAndWithdraw in one transaction if allowed', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;

    const expectedERC20Buyer = toBN(await erc20.balanceOf(bidData.bidder));

    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);

    // wait beyond payment window to move to FAILED
    const paymentWindow = await payments.paymentWindow();
    await timeTravel.wait(defaultExtendableBy + Number(paymentWindow) + 5);
    assert.equal(await payments.acceptsRefunds(bidData.paymentId), true);
    // Check expected ERC20 of buyer before refunding:
    expectedERC20Buyer.iadd(toBN(initialBuyerERC20)).isub(toBN(bidData.bidAmount));
    await assertBalances(erc20, [bidData.bidder], [expectedERC20Buyer]);

    assert.equal(await payments.onlyUserCanWithdraw(bidData.bidder), false);

    // Anyone can execute refundAndWithdraw.
    await payments.refundAndWithdraw(bidData.paymentId, { from: bob });

    assert.equal(await payments.paymentState(bidData.paymentId), REFUNDED);
    // After refundAndWithdraw: no balance in payments contract, all ERC20 refunded
    expectedERC20Buyer.iadd(toBN(bidData.bidAmount));
    await assertBalances(payments, [bidData.bidder], [0]);
    await assertBalances(erc20, [bidData.bidder], [expectedERC20Buyer]);
  });

  it('ASSET_TRANSFERRING blocks another Bid', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidder = operatorAccount.address;
    bidData2.bidAmount = 2 * bidData.bidAmount;
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData2, initialBuyerERC20, initialBuyerETH),
      'bids are only accepted if state is either NOT_STARTED or AUCTIONING',
    );
  });

  it('ASSET_TRANSFERRING blocks refund', async () => {
    await payments.registerAsSeller({ from: bidData.seller }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
    await timeTravel.waitUntil(endsAt + 10);
    assert.equal(await payments.paymentState(bidData.paymentId), ASSET_TRANSFERRING);
    await truffleAssert.reverts(
      payments.refund(bidData.paymentId),
      'payment does not accept refunds at this stage',
    );
  });

  it('if isSellerRegistrationRequired == false, no need to register', async () => {
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;
    await truffleAssert.reverts(
      bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH),
      'seller not registered',
    );
    await payments.setIsSellerRegistrationRequired(false, { from: deployer }).should.be.fulfilled;
    await bid(sellerPrivKey, bidData, initialBuyerERC20, initialBuyerETH);
  });

  it('Bid requirements are correctly checked', async () => {
    // This test checks the fulfillment of all requirements to accept a payment
    // By starting with not fulfilling any, checking revert messages, then
    // fulfilling one & checking new revert message, etc., until accepted.
    await payments.setIsSellerRegistrationRequired(true, { from: deployer }).should.be.fulfilled;

    const bidData2 = JSON.parse(JSON.stringify(bidData));
    bidData2.bidAmount = String(initialBuyerETH + 123);

    // Carol will be the buyer:
    assert.equal(bidData2.bidder, bidData2.bidder);
    // And also funding Carol with ETH so that she can approve
    await provideFunds(deployer, bidData2.bidder, initialBuyerETH);

    const sigSeller = generateSellerSig(sellerPrivKey, bidData2.paymentId);
    // should fail unless the buyer is the sender of the TX
    await truffleAssert.reverts(
      payments.bid(bidData2, dummySignature, sigSeller, { from: operator }),
      'only bidder can execute this function',
    );

    await truffleAssert.fails(
      payments.bid(bidData2, dummySignature, sigSeller, { from: bidData2.bidder }),
      'incorrect operator signature',
    );

    const signature = await signEIP712(operatorPrivKey, prepareDataToSignBid, bidData2, true);

    await truffleAssert.fails(
      payments.bid(bidData2, signature, sigSeller, { from: bidData2.bidder }),
      'seller not registered',
    );

    await payments.registerAsSeller({ from: bidData2.seller }).should.be.fulfilled;

    // fails due to insufficient funds:
    await truffleAssert.fails(
      payments.bid(bidData2, signature, sigSeller, { from: bidData2.bidder }),
      'insufficient allowance',
    );

    // still insufficient funds because of lack of approval:
    await erc20.transfer(bidData2.bidder, bidData2.bidAmount, { from: deployer });

    await truffleAssert.fails(
      payments.bid(bidData2, signature, sigSeller, { from: bidData2.bidder }),
      'insufficient allowance.',
    );

    // finally OK after approving, at least regarding having enough funds
    await erc20.approve(payments.address, bidData2.bidAmount, { from: bidData.bidder }).should.be.fulfilled;

    // fails unless fee is below 100%
    const wrongPaymentData2 = JSON.parse(JSON.stringify(bidData2));
    wrongPaymentData2.feeBPS = 10100;
    await truffleAssert.fails(
      bid(sellerPrivKey, wrongPaymentData2, 0, 0),
      'fee cannot be larger than maxFeeBPS',
    );

    // it finally is accepted
    await payments.bid(bidData2, signature, sigSeller, { from: bidData2.bidder }).should.be.fulfilled;
  });
});
