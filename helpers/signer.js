const EIP712DomainTypes = [
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

function getEIP712DomainInstance(chainId, contractAddress, isERC20) {
  const name = (isERC20 === true) ? 'LivingAssets ERC20 Payments' : 'LivingAssets Native CryptoPayments';
  return {
    name,
    version: '1',
    chainId,
    verifyingContract: contractAddress,
  };
}

function prepareDataToSignBuyNow({
  msg, chainId, contractAddress, isERC20,
}) {
  return {
    data: {
      types: {
        EIP712Domain: EIP712DomainTypes,
        BuyNowInput,
      },
      domain: getEIP712DomainInstance(chainId, contractAddress, isERC20),
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
        EIP712Domain: EIP712DomainTypes,
        BidInput,
      },
      domain: getEIP712DomainInstance(chainId, contractAddress, isERC20),
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
        EIP712Domain: EIP712DomainTypes,
        AssetTransferResult,
      },
      domain: getEIP712DomainInstance(chainId, contractAddress, isERC20),
      primaryType: 'AssetTransferResult',
      message: msg,
    },
  };
}

module.exports = {
  prepareDataToSignBuyNow,
  prepareDataToSignBid,
  prepareDataToSignAssetTransfer,
};
