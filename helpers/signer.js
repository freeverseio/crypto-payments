const ERC712DomainTypes = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const BuyNowInput = [
  { name: 'paymentId', type: 'bytes32' },
  { name: 'amount', type: 'uint256' },
  { name: 'feeBPS', type: 'uint256' },
  { name: 'universeId', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'buyer', type: 'address' },
  { name: 'seller', type: 'address' },
];

const BidInput = [
  { name: 'paymentId', type: 'bytes32' },
  { name: 'endsAt', type: 'uint256' },
  { name: 'bidAmount', type: 'uint256' },
  { name: 'feeBPS', type: 'uint256' },
  { name: 'universeId', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
  { name: 'bidder', type: 'address' },
  { name: 'seller', type: 'address' },
];

const AssetTransferResult = [
  { name: 'paymentId', type: 'bytes32' },
  { name: 'wasSuccessful', type: 'bool' },
];

function getERC712DomainInstance(chainId, contractAddress, isERC20) {
  const name = (isERC20 === true) ? 'LivingAssets ERC20 Payments' : 'LivingAssets Native CryptoPayments';
  return {
    name,
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  };
}

function prepareDataToSignPayment({
  msg, chainId, contractAddress, isERC20,
}) {
  return {
    data: {
      types: {
        EIP712Domain: ERC712DomainTypes,
        BuyNowInput,
      },
      domain: getERC712DomainInstance(chainId, contractAddress, isERC20),
      primaryType: 'BuyNowInput',
      message: msg,
    },
  };
}

function prepareDataToSignBid({
  msg, chainId, contractAddress, isERC20,
}) {
  return {
    data: {
      types: {
        EIP712Domain: ERC712DomainTypes,
        BidInput,
      },
      domain: getERC712DomainInstance(chainId, contractAddress, isERC20),
      primaryType: 'BidInput',
      message: msg,
    },
  };
}

function prepareDataToSignAssetTransfer({
  msg, chainId, contractAddress, isERC20,
}) {
  return {
    data: {
      types: {
        EIP712Domain: ERC712DomainTypes,
        AssetTransferResult,
      },
      domain: getERC712DomainInstance(chainId, contractAddress, isERC20),
      primaryType: 'AssetTransferResult',
      message: msg,
    },
  };
}

module.exports = {
  prepareDataToSignPayment,
  prepareDataToSignBid,
  prepareDataToSignAssetTransfer,
};
