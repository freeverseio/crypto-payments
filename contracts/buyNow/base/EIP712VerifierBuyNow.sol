// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./IEIP712VerifierBuyNow.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Verification of MetaTXs for BuyNows using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @notice Full contract documentation in IEIP712VerifierBuyNow
 */

contract EIP712VerifierBuyNow is IEIP712VerifierBuyNow, EIP712 {
    using ECDSA for bytes32;
    bytes32 private constant _TYPEHASH_PAYMENT =
        keccak256(
            "BuyNowInput(bytes32 paymentId,uint256 amount,uint256 feeBPS,uint256 universeId,uint256 deadline,address buyer,address seller)"
        );

    bytes32 private constant _TYPEHASH_ASSETTRANSFER =
        keccak256("AssetTransferResult(bytes32 paymentId,bool wasSuccessful)");

    constructor(string memory name, string memory version) EIP712(name, version) {}

    /// @inheritdoc IEIP712VerifierBuyNow
    function verifyBuyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(abi.encode(_TYPEHASH_PAYMENT, buyNowInp))
        ).recover(signature);
        return signer == recoveredSigner;
    }

    /// @inheritdoc IEIP712VerifierBuyNow
    function verifyAssetTransferResult(
        AssetTransferResult calldata transferResult,
        bytes calldata signature,
        address signer
    ) public view returns (bool) {
        address recoveredSigner = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _TYPEHASH_ASSETTRANSFER,
                    transferResult.paymentId,
                    transferResult.wasSuccessful
                )
            )
        ).recover(signature);
        return signer == recoveredSigner;
    }
}
