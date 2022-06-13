/* eslint-disable no-undef */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-console */
require('chai')
  .use(require('chai-as-promised'))
  .should();

const EIP712Verifier = artifacts.require('EIP712VerifierAuction');
const BuyNowNative = artifacts.require('BuyNowNative');

module.exports = (deployer, network) => {
  deployer.then(async () => {
    if (network === 'test') return;
    console.log(`Deploying to network: ${network}`);

    // Deploy the EIP721 verifier
    const name = 'LivingAssets Native CryptoPayments';
    const version = 1;
    const eip712 = await EIP712Verifier.new(name, version).should.be.fulfilled;

    const { paymentsData } = deployer.networks[network];

    console.log('  ...with description: ', paymentsData.currencyDescriptor);
    console.log('  ...with associated EIP712 verifier at: ', eip712.address);
    const payments = await BuyNowNative.new(
      paymentsData.currencyDescriptor,
      eip712.address,
    ).should.be.fulfilled;

    console.log('🚀  Auctions in native crypto deployed at:', payments.address);
  });
};
