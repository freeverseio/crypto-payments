// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./base/ISignableStructsAuction.sol";

/**
 * @title Interface to Escrow Contract for Payments in Auction & BuyNow modes, in ERC20 tokens.
 * @author Freeverse.io, www.freeverse.io
 * @dev The contract that implements this interface adds an entry point for Bid processes in Auctions,
 * which are defined and documented in the AuctionBase contract.
 * - in the 'bid' method, the buyer is the msg.sender (the buyer therefore signs the TX),
 *   and the operator's EIP712-signature of the BidInput struct is provided as input to the call.
 * - in the 'relayedBid' method, anyone can be msg.sender, but both the operator and the buyer
 *   EIP712-signatures of the BidInput struct are provided as input to the call.
 *
 *  To improve user UX, the default settings are such that when a bidder is outbid by a different user,
 *  he/she is automatically refunded to the external ERC20, as opposite to refunding to this contract's
 *  local balance. Accepting a new bid and transferring funds to the previous bidder in the same TX is
 *  a safe operation with ERC20 tokens, because the ERC20 contracts accepted have been previously
 *  reviewed for absence of malicious `transfer` implementations. 
 *
 */

interface IAuctionERC20 is ISignableStructsAuction {
    /**
     * @dev Event emitted on change of whether outbids for assets in a universe should
     *  leave previous highest bidder's funds as local balance,
     *  or transfer funds back to previous highest bidder.
     * @param universeId The id of the universe
     * @param toLocalBalanceOnOutBid - if true: leave previous highest bidder funds as local balance
     *   if false: transfer funds back to previous highest bidder
     */
    event ToLocalBalanceOnOutBid(uint256 indexed universeId, bool toLocalBalanceOnOutBid);

    /**
     * @notice Processes an arriving bid, and either starts a new Auction process,
     *   or updates an existing one.
     * @dev Executed by the bidder, who relays the operator's signature.
     *  This method will transfer only the minimum required amount from the bidder
     *  to this contract, taking into account any existing local balance,
     *  and the case where the same bidder raises his/her previous max bid,
     *  in which case only the difference between bids is required.
     *  If all requirements are fulfilled, it stores the data relevant for the next steps
     *  of the auction, and it locks the funds in this contract.
     *  If this is the first bid of an auction, it moves its state to AUCTIONING,
     *  whereas if it arrives on an on-going auction, it remains in AUCTIONING.
     * @param bidInput The struct containing all required bid data
     * @param operatorSignature The signature of 'bidInput' by the operator
     */
    function bid(BidInput calldata bidInput, bytes calldata operatorSignature) external;

    /**
     * @notice Processes an arriving bid, and either starts a new Auction process,
     *   or updates an existing one.
     * @dev Executed by the anyone, who must relay both the operator and the bidder signatures.
     *  This method will transfer only the minimum required amount from the bidder
     *  to this contract, taking into account any existing local balance,
     *  and the case where the same bidder raises his/her previous max bid,
     *  in which case only the difference between bids is required.
     *  If all requirements are fulfilled, it stores the data relevant for the next steps
     *  of the auction, and it locks the funds in this contract.
     *  If this is the first bid of an auction, it moves its state to AUCTIONING,
     *  whereas if it arrives on an on-going auction, it remains in AUCTIONING.
     * @param bidInput The struct containing all required bid data
     * @param bidderSignature The signature of 'bidInput' by the bidder
     * @param operatorSignature The signature of 'bidInput' by the operator
     */
    function relayedBid(
        BidInput calldata bidInput,
        bytes calldata bidderSignature,
        bytes calldata operatorSignature
    ) external;

    /**
     * @notice Sets whether outbids for assets in a universe should
     *  leave previous highest bidder's funds as local balance,
     *  or transfer funds back to previous highest bidder.
     * @dev default value for all universes is false, since internal mapping has
     *  no entry unless this function has been previously called.
     * @param universeId The id of the universe
     * @param toLocalBalanceOnOutBid - if true: leave previous highest bidder funds as local balance
     *   if false: transfer funds back to previous highest bidder
    */
    function setToLocalBalanceOnOutBid(uint256 universeId, bool toLocalBalanceOnOutBid) external;

    /**
     * @notice Returns whether outbids for assets in a universe should
     *  leave previous highest bidder's funds as local balance,
     *  or transfer funds back to previous highest bidder.
     * @param universeId The id of the universe
     * @return true if must leave previous highest bidder funds as local balance,
     *   false if must transfer funds back to previous highest bidder
     */
    function universeToLocalBalanceOnOutBid(uint256 universeId) external view returns(bool);
}
