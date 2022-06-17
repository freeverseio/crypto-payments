/* eslint-disable no-undef */
const { assert } = require('chai');

require('chai')
  .use(require('chai-as-promised'))
  .should();
const Wallet = require('ethereumjs-wallet').default;
const ethSigUtil = require('eth-sig-util');
const { prepareDataToSignBuyNow, prepareDataToSignAssetTransfer } = require('../helpers/signer');
const { fromHexString } = require('../helpers/utils');

const EIP712Verifier = artifacts.require('EIP712VerifierBuyNow');

contract('EIP712VerifierBuyNow', (accounts) => {
  // eslint-disable-next-line no-unused-vars
  const it2 = async (text, f) => {};

  const [deployer] = accounts;
  const wallet = Wallet.generate();
  const sender = web3.utils.toChecksumAddress(wallet.getAddressString());
  const paymentData = {
    paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
    amount: '23',
    feeBPS: 500,
    universeId: '1',
    deadline: '12345',
    buyer: sender,
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

  it('payment signature matches expected explicit value 0 / EIP712 spec', async () => {
    // Example taken from the EIP:
    // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
    // https://github.com/ethereum/EIPs/blob/master/assets/eip-712/Example.js
    const expectedSig = '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c';
    const privateKey = web3.utils.keccak256('cow'); // this private key corresponds to 0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826
    assert.equal(privateKey, '0xc85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4');
    const spec = {
      jsonrpc: '2.0',
      method: 'eth_signTypedData',
      params: [
        '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
        {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: 1,
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
      ],
      id: 1,
    };
    const sig = ethSigUtil.signTypedMessage(
      fromHexString(privateKey.substr(2)),
      {
        data: {
          types: spec.params[1].types,
          domain: spec.params[1].domain,
          primaryType: spec.params[1].primaryType,
          message: spec.params[1].message,
        },
      },
    );
    assert.equal(sig, expectedSig);
  });

  it('payment signature matches expected explicit value - 0 / happy path', async () => {
    const expectedSig = '0x14fb2c378754b0130750614636c09b27719a752f522b7128c33201d201807f857b4764b0562b467b9365e4f2c663ae5ebecf1a9ef4c81cce086d0bdf3177fd131b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '1',
      deadline: '1646175615',
      buyer: '0x5Ca59cbA5D0D0D604bF59cD0e7b3cD3c350142BE',
      seller: '0xBDcaD33BA6eF2086F2511610Fa5Bedaf062CC1Cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBuyNow({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 1 / happy path', async () => {
    const expectedSig = '0xc5d7610ec3351430bf30bc256768e844957e2dde110fabc0f4f9dc9cbfd4fe4a16c0623ecc52a947f61a53bf812f7eabb6bba4c2af8887b25f84a80eb6c1586d1b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '1',
      deadline: '12345',
      buyer: '0x5Ca59cbA5D0D0D604bF59cD0e7b3cD3c350142BE',
      seller: '0xBDcaD33BA6eF2086F2511610Fa5Bedaf062CC1Cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBuyNow({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 2 / empty universeId', async () => {
    const expectedSig = '0xe6cc009ff2a2ec9076002a4539895af46eebf0429d4e2e289fbaad94f9e18b0f1105dc1e2a3795007ed18b229f6f2a57b01bc3722a96553fff2b3cc18ec2c9d01b';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '0xf25186B5081Ff5cE73482AD761DB0eB0d25abfBF';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      buyer: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBuyNow({
        msg: hardcodedPaymentData,
        chainId: hardcodedChainId,
        contractAddress: hardcodedContractAddr,
      }),
    );
    assert.equal(signature, expectedSig);
  });

  it('payment signature matches expected explicit value - 3 / empty contractAddr', async () => {
    const expectedSig = '0x6c4ebdac3f52c59f94df03105524ef1f67a29e7715d5b6a69e3e7ad54a47261543dc4f1262d053b717d94bb84cf961dc3956ee32e3475a5e8d180813c133f7551c';
    const hardcodedPrivKey = 'aaf06722787393a80c2079882825f9777f003949bb7d41af20c4efe64f6a31f3';
    const hardcodedChainId = 1337;
    const hardcodedContractAddr = '';
    const hardcodedPaymentData = {
      paymentId: '0xb884e47bc302c43df83356222374305300b0bcc64bb8d2c300350e06c790ee03',
      amount: '23',
      feeBPS: 500,
      universeId: '',
      deadline: '12345',
      buyer: '0x5ca59cba5d0d0d604bf59cd0e7b3cd3c350142be',
      seller: '0xbdcad33ba6ef2086f2511610fa5bedaf062cc1cf',
    };

    const signature = ethSigUtil.signTypedMessage(
      fromHexString(hardcodedPrivKey),
      prepareDataToSignBuyNow({
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
      prepareDataToSignBuyNow({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );
    assert.equal(await verifier.verifyBuyNow(paymentData, signature, sender), true);
  });

  it('payment signature is rejected if incorrect', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignBuyNow({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const wrongPaymentData = JSON.parse(JSON.stringify(paymentData));
    wrongPaymentData.amount = '24';

    assert.equal(await verifier.verifyBuyNow(paymentData, signature, sender), true);
    assert.equal(await verifier.verifyBuyNow(wrongPaymentData, signature, sender), false);
  });

  it('payment signature is only valid for one contract address', async () => {
    const signature = ethSigUtil.signTypedMessage(
      wallet.getPrivateKey(),
      prepareDataToSignBuyNow({
        msg: paymentData,
        chainId: await web3.eth.getChainId(),
        contractAddress: verifier.address,
      }),
    );

    const verifier2 = await EIP712Verifier.new('LivingAssets Native CryptoPayments', '1').should.be.fulfilled;

    assert.equal(await verifier.verifyBuyNow(paymentData, signature, sender), true);
    assert.equal(await verifier2.verifyBuyNow(paymentData, signature, sender), false);
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
