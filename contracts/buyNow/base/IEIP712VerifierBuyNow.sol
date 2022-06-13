// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./ISignableStructsBuyNow.sol";

/**
 * @title Interface to Verification of MetaTXs for BuyNows using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract defines the interface to the two verifying functions
 *  for the structs defined in ISignableStructsBuyNow (BuyNowInput, AssetTransferResult),
 *  used within the BuyNow process.
 */

interface IEIP712VerifierBuyNow is ISignableStructsBuyNow {
    /**
     * @notice Verifies that the provided BuyNowInput struct has been signed
     *  by the provided signer.
     * @param buyNowInp The provided BuyNowInput struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the
     *  provided signer having signed the input struct
     */
    function verifyBuyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata signature,
        address signer
    ) external view returns (bool);

    /**
     * @notice Verifies that the provided AssetTransferResult struct
     *  has been signed by the provided signer.
     * @param transferResult The provided AssetTransferResult struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the signer
     *  having signed the input struct
     */
    function verifyAssetTransferResult(
        AssetTransferResult calldata transferResult,
        bytes calldata signature,
        address signer
    ) external view returns (bool);
}
