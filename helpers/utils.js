/* eslint-disable no-undef */
const fromHexString = (hexString) => new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const toBN = (x) => web3.utils.toBN(x);

const provideFunds = async (_from, _to, _ETHSupplyForBuyer) => {
  await web3.eth.sendTransaction({
    from: _from,
    to: _to,
    value: _ETHSupplyForBuyer,
  });
};

// Starting with an account created from a privateKey in these test scripts,
// it registers it in the environment testnet,
// so that it can be used to sign fund transfers.
// A bit hacky, but it works: just import and unlock.
const registerAccountInLocalTestnet = async (acc) => {
  const localAcc = await web3.eth.personal.importRawKey(acc.privateKey, 'dummyPassw');
  await web3.eth.personal.unlockAccount(localAcc, 'dummyPassw');
};

function getGasFee(receipt) {
  return toBN(receipt.receipt.gasUsed).mul(toBN(receipt.receipt.effectiveGasPrice));
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

const addressFromPk = (pvk) => {
  const acc = web3.eth.accounts.privateKeyToAccount(pvk);
  return acc.address;
};

const generateSellerSig = (pvk, digest) => {
  const acc = web3.eth.accounts.privateKeyToAccount(pvk);
  return acc.sign(digest).signature;
};

module.exports = {
  fromHexString,
  toBN,
  provideFunds,
  registerAccountInLocalTestnet,
  getGasFee,
  assertBalances,
  addressFromPk,
  generateSellerSig,
};
