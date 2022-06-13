// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./ISignableStructsAuction.sol";

/**
 * @title Interface to Verification of MetaTXs for Auctions using EIP712.
 * @author Freeverse.io, www.freeverse.io
 * @dev This contract defines the interface to the verifying function
 *  for the struct defined in ISignableStructsAuction (BidInput),
 *  used in auction processes.
 */

interface IEIP712VerifierAuction is ISignableStructsAuction {
    /**
     * @notice Verifies that the provided BidInput struct has been signed
     *  by the provided signer.
     * @param bidInput The provided BidInput struct
     * @param signature The provided signature of the input struct
     * @param signer The signer's address that we want to verify
     * @return Returns true if the signature corresponds to the
     *  provided signer having signed the input struct
     */
    function verifyBid(
        BidInput calldata bidInput,
        bytes calldata signature,
        address signer
    ) external view returns (bool);
}
