// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./IAuctionNative.sol";
import "./base/AuctionBase.sol";
import "../buyNow/BuyNowNative.sol";
import "./base/IEIP712VerifierAuction.sol";

/**
 * @title Escrow Contract for Payments in Auction & BuyNow modes, in Native Cryptocurrencies.
 * @author Freeverse.io, www.freeverse.io
 * @notice Full contract documentation in IAuctionNative
 */

contract AuctionNative is IAuctionNative, AuctionBase, BuyNowNative {
    constructor(
        string memory currencyDescriptor,
        address eip712,
        uint256 minIncreasePercentage,
        uint256 time2Extend,
        uint256 extendableBy
    )
        BuyNowNative(currencyDescriptor, eip712)
        AuctionBase(minIncreasePercentage, time2Extend, extendableBy)
    {}

    /// @inheritdoc IAuctionNative
    function bid(BidInput calldata bidInput, bytes calldata operatorSignature)
        external
        payable
    {
        require(
            msg.sender == bidInput.bidder,
            "only bidder can execute this function"
        );
        address operator = universeOperator(bidInput.universeId);
        require(
            IEIP712VerifierAuction(_eip712).verifyBid(
                bidInput,
                operatorSignature,
                operator
            ),
            "incorrect operator signature"
        );
        // The following requirement avoids possible mistakes in building the TX's msg.value by a user.
        // While the funds provided can be less than the bid amount (in case of payer having local balance),
        // there is no reason for providing more funds than the bid amount.
        require(
            (msg.value <= bidInput.bidAmount),
            "new funds provided must be less than bid amount"
        );
        _processBid(operator, bidInput);
    }

    /// @inheritdoc IAuctionBase
    function paymentState(bytes32 paymentId) public view override(AuctionBase, IBuyNowBase, BuyNowBase) returns (State) {
        return AuctionBase.paymentState(paymentId);
    }

    /**
     * @dev On arrival of a bid that outbids a previous one,
     *  refunds previous bidder by increasing local balance.
     * @param bidInput The struct containing all bid data
     */
    function _refundPreviousBidder(BidInput memory bidInput) internal override {
        uint256 prevHighestBid = _payments[bidInput.paymentId].amount;
        if (prevHighestBid > 0) {
            address prevHighestBidder = _payments[bidInput.paymentId].buyer;
            _balanceOf[prevHighestBidder] += prevHighestBid;
        }
    }
}
