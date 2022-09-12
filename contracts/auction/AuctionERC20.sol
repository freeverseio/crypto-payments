// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./IAuctionERC20.sol";
import "./base/AuctionBase.sol";
import "../buyNow/BuyNowERC20.sol";

/**
 * @title Escrow Contract for Payments in Auction & BuyNow modes, in ERC20 tokens.
 * @author Freeverse.io, www.freeverse.io
 * @notice Full contract documentation in IAuctionERC20
 */

contract AuctionERC20 is IAuctionERC20, AuctionBase, BuyNowERC20 {

    // mapping between universeId and whether outbids for assets in that universe should:
    // - if true: leave previous highest bidder funds as local balance
    // - if false: transfer funds back to previous highest bidder
    mapping(uint256 => bool) internal _toLocalBalanceOnOutBid;

    constructor(
        address erc20Address,
        string memory currencyDescriptor,
        address eip712,
        uint256 minIncreasePercentage,
        uint256 time2Extend,
        uint256 extendableBy
    )
        BuyNowERC20(erc20Address, currencyDescriptor, eip712)
        AuctionBase(minIncreasePercentage, time2Extend, extendableBy)
    {}

    /// @inheritdoc IAuctionERC20
    function setToLocalBalanceOnOutBid(
        uint256 universeId,
        bool toLocalBalanceOnOutBid
    ) external onlyOwner {
        _toLocalBalanceOnOutBid[universeId] = toLocalBalanceOnOutBid;
        emit ToLocalBalanceOnOutBid(universeId, toLocalBalanceOnOutBid);
    }

    /// @inheritdoc IAuctionERC20
    function bid(
        BidInput calldata bidInput,
        bytes calldata operatorSignature,
        bytes calldata sellerSignature
    ) external {
        require(
            msg.sender == bidInput.bidder,
            "AuctionERC20::bid: only bidder can execute this function"
        );
        address operator = universeOperator(bidInput.universeId);
        require(
            IEIP712VerifierAuction(_eip712).verifyBid(
                bidInput,
                operatorSignature,
                operator
            ),
            "AuctionERC20::bid: incorrect operator signature"
        );
        _processBid(operator, bidInput, sellerSignature);
    }

    /// @inheritdoc IAuctionERC20
    function relayedBid(
        BidInput calldata bidInput,
        bytes calldata bidderSignature,
        bytes calldata operatorSignature,
        bytes calldata sellerSignature
    ) external {
        address operator = universeOperator(bidInput.universeId);
        require(
            IEIP712VerifierAuction(_eip712).verifyBid(
                bidInput,
                operatorSignature,
                operator
            ),
            "AuctionERC20::relayedBid: incorrect operator signature"
        );
        require(
            IEIP712VerifierAuction(_eip712).verifyBid(
                bidInput,
                bidderSignature,
                bidInput.bidder
            ),
            "AuctionERC20::relayedBid: incorrect bidder signature"
        );
        _processBid(operator, bidInput, sellerSignature);
    }

    /**
     * @dev On arrival of a bid that outbids a previous one,
     *  refunds previous bidder by increasing local balance or by
     *  transferring to the external ERC20 contract, depending
     *  on value of _toLocalBalanceOnOutBid possibly set by bidder.
     *  Unlike in native crypto flows, this transfer is safe if the 
     *  ERC20 contract has been reviewed before accepting, and checked
     *  for a legit transfer method implementation.
     * @param bidInput The struct containing all bid data
     */
    function _refundPreviousBidder(BidInput memory bidInput) internal override {
        uint256 prevHighestBid = _payments[bidInput.paymentId].amount;
        if (prevHighestBid > 0) {
            address prevHighestBidder = _payments[bidInput.paymentId].buyer;
            if (_toLocalBalanceOnOutBid[bidInput.universeId]) {
                _balanceOf[prevHighestBidder] += prevHighestBid;
            } else {
                _transfer(prevHighestBidder, prevHighestBid);
            }
        }
    }

    // VIEW FUNCTIONS

    /// @inheritdoc IAuctionBase
    function paymentState(bytes32 paymentId) public view override(AuctionBase, IBuyNowBase, BuyNowBase) returns (State) {
        return AuctionBase.paymentState(paymentId);
    }

    /// @inheritdoc IAuctionERC20
    function universeToLocalBalanceOnOutBid(uint256 universeId)
        public
        view
        returns (bool)
    {
        return _toLocalBalanceOnOutBid[universeId];
    }
}
