/* eslint-disable no-undef */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-console */
require('chai')
  .use(require('chai-as-promised'))
  .should();

const EIP712Verifier = artifacts.require('EIP712VerifierAuction');
const AuctionNative = artifacts.require('AuctionNative');
const AuctionERC20 = artifacts.require('AuctionERC20');

module.exports = (deployer, network) => {
  deployer.then(async () => {
    if (network === 'test') return;
    const { deployOptions } = deployer.networks[network];

    console.log(`Deploying to network: ${network}`);
    console.log('...Coin/Token description: ', deployOptions.currencyDescriptor);

    const name = 'LivingAssets Native CryptoPayments';
    const version = 1;

    // Reuse existing EIP712Verifier unless specified in deployOptions:
    let eip712address = deployOptions.reuseEIP712at;
    if (web3.utils.isAddress(eip712address)) {
      console.log(`...Reusing existing EIP712 Verifier at ${eip712address}`);
    } else {
      console.log('...Deploying EIP712 Verifier...');
      const eip712 = await EIP712Verifier.new(name, version).should.be.fulfilled;
      console.log(`...Deploying EIP712 Verifier... deployed at: ${eip712.address}`);
      eip712address = eip712.address;
    }

    // Deploy Native Crypto contract is so specified in deployOptions:
    if (!deployOptions.isERC20) {
      console.log('...Deploying Auctions in Native Crypto...');
      const auctionNative = await AuctionNative.new(
        deployOptions.currencyDescriptor,
        eip712address,
        deployOptions.minIncreasePercentage,
        deployOptions.time2Extend,
        deployOptions.extendableBy,
      ).should.be.fulfilled;
      console.log('...Deploying Auctions in Native Crypto... deployed at:', auctionNative.address);
    }

    // Deploy ERC20 contract is so specified in deployOptions:
    if (deployOptions.isERC20) {
      console.log('...Deploying Auctions in ERC20...');
      if (!web3.utils.isAddress(deployOptions.erc20Address)) {
        console.log('...No correct address provided for ERC20 token.');
        console.log('...Will not deploy the corresponding payments contract');
        return;
      }

      const auctionERC20 = await AuctionERC20.new(
        deployOptions.erc20Address,
        deployOptions.currencyDescriptor,
        eip712address,
        deployOptions.minIncreasePercentage,
        deployOptions.time2Extend,
        deployOptions.extendableBy,
      ).should.be.fulfilled;
      console.log('...Deploying Auctions in ERC20... deployed at:', auctionERC20.address);
      console.log('...associated with existing ERC20 token at:', deployOptions.erc20Address);
    }
  });
};
