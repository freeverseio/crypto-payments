// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./base/IBuyNowBase.sol";

/**
 * @title Interface to Escrow Contract for Payments in BuyNow mode, in ERC20 tokens.
 * @author Freeverse.io, www.freeverse.io
 * @dev The contract that implements this interface adds two entry points for BuyNow payments,
 * which are defined and documented in the inherited IBuyNowBase.
 * - in the 'buyNow' method, the buyer is the msg.sender (the buyer therefore signs the TX),
 *   and the operator's EIP712-signature of the BuyNowInput struct is provided as input to the call.
 * - in the 'relayedBuyNow' method, anyone can be msg.sender, but both the operator and the buyer
 *   EIP712-signatures of the BuyNowInput struct are provided as input to the call.
 */

interface IBuyNowERC20 is IBuyNowBase {
    /**
     * @notice Starts Payment process by the buyer.
     * @dev Executed by the buyer, who relays the operator's signature.
     *  This method will transfer only the minimum required amount from the bidder
     *  to this contract, re-using any exisiting local balance.
     *  If all requirements are fulfilled, it stores the data relevant
     *  for the next steps of the payment, and it locks the funds
     *  in this contract.
     *  Follows standard Checks-Effects-Interactions pattern
     *  to protect against re-entrancy attacks.
     *  Moves payment to ASSET_TRANSFERRING state.
     * @param buyNowInp The struct containing all required payment data
     * @param operatorSignature The signature of 'buyNowInp' by the operator
     */
    function buyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata operatorSignature
    ) external;

    /**
     * @notice Starts the Payment process via relay-by-operator.
     * @dev Executed by anyone, who relays  relay both the operator and the buyer signatures.
     *  The buyer must have approved the amount to this contract before.
     *  If all requirements are fulfilled, it stores the data relevant
     *  for the next steps of the payment, and it locks the ERC20
     *  in this contract.
     *  Follows standard Checks-Effects-Interactions pattern
     *  to protect against re-entrancy attacks.
     *  Moves payment to ASSET_TRANSFERRING state.
     * @param buyNowInp The struct containing all required payment data
     * @param operatorSignature The signature of 'buyNowInp' by the operator
     * @param buyerSignature The signature of 'buyNowInp' by the buyer
     */
    function relayedBuyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata operatorSignature,
        bytes calldata buyerSignature
    ) external;

    /**
     * @notice Returns the address of the ERC20 contract from which
     *  tokens are accepted for payments
     * @return the address of the ERC20 contract
     */
    function erc20() external view returns (address);

    /**
     * @notice Returns the ERC20 balance of address in the ERC20 contract
     * @param addr the address that is queried
     * @return the balance in the external ERC20 contract
     */
    function erc20BalanceOf(address addr) external view returns (uint256);

    /**
     * @notice Returns the allowance that the buyer has approved
     *  directly in the ERC20 contract in favour of this contract.
     * @param buyer the address of the buyer
     * @return the amount allowed by buyer
     */
    function allowance(address buyer) external view returns (uint256);
}
