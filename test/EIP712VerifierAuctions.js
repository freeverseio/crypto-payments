/* eslint-disable no-undef */
const { assert } = require('chai');

require('chai')
  .use(require('chai-as-promised'))
  .should();
const Wallet = require('ethereumjs-wallet').default;
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBid, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const { fromHexString } = require('../helpers/utils');

const EIP712Verifier = artifacts.require('EIP712VerifierAuction');

contract('EIP712VerifierAuctions', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};

  const [deployer] = accounts;
  const wallet = Wallet.generate();
  const sender = web3.utils.toChecksumAddress(wallet.getAddressString());
  const paymentData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    endsAt: '123456',
    bidAmount: '23',
    feeBPS: 500,
    universeId: '1',
    deadline: '12345',
    bidder: sender,
    seller: deployer,
  };
  const assetTransferResultData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    wasSuccessful: true,
  };

  let verifier;

  beforeEach(async () => {
    verifier = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;
  });

  it('payment signature matches expected explicit value - 0 / happy path', async () => {
    const expectedSig = '0x839b6e22714ffe2287e69fbc654e529406e4a1d17d44a81c57fb5eec46bb43a8360241e3a714c21f05d9f26ee6c0905fff3dde23ab5434398606ff07ca2d3cfe1b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      endsAt: '1646176666',
      bidAmount: '23',
      feeBPS: 500,
      universeId: '1',
      deadline: '1646175615',
      bidder: '0x5Ca59cbA5D0D0D604bF59cD0e7b3cD3c350142BE',
      seller: '0xBDcaD33BA6eF2086F2511610Fa5Bedaf062CC1Cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBid({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 1 / happy path', async () => {
    const expectedSig = '0x4f42ebd520137c0872546fc097cd2fe6244129f0f14a38131f3b49a17b8a466520ab117879e7df87a287b23bb2992e10c9c364bea98bc015ac37bdd9e57cfdeb1c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      endsAt: '1646176666',
      bidAmount: '23',
      feeBPS: 500,
      universeId: '1',
      deadline: '12345',
      bidder: '0x5Ca59cbA5D0D0D604bF59cD0e7b3cD3c350142BE',
      seller: '0xBDcaD33BA6eF2086F2511610Fa5Bedaf062CC1Cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBid({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 2 / empty universeId', async () => {
    const expectedSig = '0x8b554fcdc1110b37d6fafa35094941e9b910cfb42bcbe75357867b4c9cec08c23f25ee671cfee82dd6dc3aaaca68ed5cccbbf6d9288f903248f8674515d4e69d1b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      endsAt: '1646176666',
      bidAmount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      bidder: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBid({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 3 / empty contractAddr', async () => {
    const expectedSig = '0xe3427cfad93b592523213dc7765d619d1421c22b11dfd95d0864e680387321d775b7a309251228d67df4e528f29ffa0de4b069bce87be7af9104ca725b93757e1b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      endsAt: '1646176666',
      bidAmount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      bidder: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBid({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature is correctly verified', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignBid({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );
    assert.equal(await verifier.verifyBid(paymentData, signature, sender), true);
  });

  it('payment signature is rejected if incorrect', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignBid({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const wrongPaymentData = JSON.parse(JSON.stringify(paymentData));
    wrongPaymentData.bidAmount = '24';

    assert.equal(await verifier.verifyBid(paymentData, signature, sender), true);
    assert.equal(await verifier.verifyBid(wrongPaymentData, signature, sender), false);
  });

  it('payment signature is only valid for one contract address', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignBid({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const verifier2 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;

    assert.equal(await verifier.verifyBid(paymentData, signature, sender), true);
    assert.equal(await verifier2.verifyBid(paymentData, signature, sender), false);
  });

  it('assetTransferResult signature is rejected if incorrect', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignAssetTransfer({
        msg: assetTransferResultData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const wrongData = JSON.parse(JSON.stringify(assetTransferResultData));
    wrongData.wasSuccessful = false;

    assert.equal(
      await verifier.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      true,
    );
    assert.equal(await verifier.verifyAssetTransferResult(wrongData, signature, sender), false);
  });

  it('assetTransferResult signature is only valid for one contract address', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignAssetTransfer({
        msg: assetTransferResultData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const verifier2 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;

    assert.equal(
      await verifier.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      true,
    );
    assert.equal(
      await verifier2.verifyAssetTransferResult(assetTransferResultData, signature, sender),
      false,
    );
  });

  it('assetTransferResult signature matches expected explicit value - 1 / happy path', async () => {
    const expectedSig = '0x5efa35c00cb7d632d775e9fff905fff41fdc44da8bb15273635e226cb4c208e9330d4eefba80d4af3f67d06287c85d5ce4fbb9d27b7dd517de9b8ec2562e0dda1b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedAssetTransferData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      wasSuccessful: true,
    };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignAssetTransfer({
        msg: hardcodedAssetTransferData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('assetTransferResult signature matches expected explicit value - 2 / empty contractAddr', async () => {
    const expectedSig = '0xc21665137720807eb871f214eff0abdca1f8a3d4ea8bd6b8fbd2b4188006ecda57bd0894bd67cae7cc93bbca9ff0367ed302c4d18dd3d202572521b398ed93651b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '';
    const hardcodedAssetTransferData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      wasSuccessful: true,
    };
    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignAssetTransfer({
        msg: hardcodedAssetTransferData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });
});
