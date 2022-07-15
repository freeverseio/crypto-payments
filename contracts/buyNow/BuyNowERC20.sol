// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./IBuyNowERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./base/BuyNowBase.sol";

/**
 * @title Escrow Contract for Payments in BuyNow mode, in ERC20 tokens.
 * @author Freeverse.io, www.freeverse.io
 * @notice Full contract documentation in IBuyNowERC20
 */

contract BuyNowERC20 is IBuyNowERC20, BuyNowBase {
    // the address of the ERC20 contract that manages the tokens that this contract accepts:
    address private immutable _erc20;

    constructor(
        address erc20Address,
        string memory currencyDescriptor,
        address eip712
    ) BuyNowBase(currencyDescriptor, eip712) {
        _erc20 = erc20Address;
    }

    /// @inheritdoc IBuyNowERC20
    function buyNow(BuyNowInput calldata buyNowInp, bytes calldata operatorSignature) external {
        require(
            msg.sender == buyNowInp.buyer,
            "BuyNowERC20::buyNow: only buyer can execute this function"
        );
        address operator = universeOperator(buyNowInp.universeId);
        require(
            IEIP712VerifierBuyNow(_eip712).verifyBuyNow(buyNowInp, operatorSignature, operator),
            "BuyNowERC20::buyNow: incorrect operator signature"
        );
        _processBuyNow(buyNowInp, operator);
    }

    /// @inheritdoc IBuyNowERC20
    function relayedBuyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata buyerSignature,
        bytes calldata operatorSignature
    ) external {
        address operator = universeOperator(buyNowInp.universeId);
        require(
            IEIP712VerifierBuyNow(_eip712).verifyBuyNow(buyNowInp, operatorSignature, operator),
            "BuyNowERC20::relayedBuyNow: incorrect operator signature"
        );
        require(
            IEIP712VerifierBuyNow(_eip712).verifyBuyNow(buyNowInp, buyerSignature, buyNowInp.buyer),
            "BuyNowERC20::relayedBuyNow: incorrect buyer signature"
        );
        _processBuyNow(buyNowInp, operator);
    }

    // PRIVATE & INTERNAL FUNCTIONS

    /**
     * @dev Method that updates buyer's local balance on arrival of a payment,
     *  re-using local balance if available, and transferring to this contract
     *  only the new funds required. Unlike in native crypto payments, here the exact minimal amount
     *  required is automatically transferred by this contract from the ERC20 contract, not depending on the
     *  amount provided by users as msg.value. There is therefore no need to account for any excess
     *  of provided funds.
     * @param buyer The address executing the payment
     * @param newFundsNeeded The elsewhere computed minimum amount of funds required to be provided by the buyer,
     *  having possible re-use of local funds into account
     * @param localFunds The elsewhere computed amount of funds available to the buyer in this contract that will be
     *  re-used in the payment
     */
    function _updateBuyerBalanceOnPaymentReceived(
        address buyer,
        uint256 newFundsNeeded,
        uint256 localFunds
    ) internal override {
        if (newFundsNeeded > 0) {
            require(
                IERC20(_erc20).transferFrom(buyer, address(this), newFundsNeeded),
                "BuyNowERC20::_updateBuyerBalanceOnPaymentReceived: ERC20 transfer failed"
            );
        }
        _balanceOf[buyer] -= localFunds;
    }

    /**
     * @dev Transfers the specified amount to the specified address.
     *  Requirements and effects (e.g. balance updates) are performed
     *  before calling this function.
     * @param to The address that must receive the ERC20 tokens.
     * @param amount The amount of tokens to transfer.
    */
    function _transfer(address to, uint256 amount) internal override {
        IERC20(_erc20).transfer(to, amount);
    }

    // VIEW FUNCTIONS

    /// @inheritdoc IBuyNowERC20
    function erc20() external view returns (address) {
        return _erc20;
    }

    /// @inheritdoc IBuyNowERC20
    function erc20BalanceOf(address addr) public view returns (uint256) {
        return IERC20(_erc20).balanceOf(addr);
    }

    /// @inheritdoc IBuyNowERC20
    function allowance(address buyer) public view returns (uint256) {
        return IERC20(_erc20).allowance(buyer, address(this));
    }

    /**
     * @notice Returns the amount available to a buyer outside this contract
     * @dev It returns only the truly available amount, taking into account
     *  that the user may have allowed less tokens than actually avaialable
     *  in the external ERC20 contract
     * @param buyer The address for which funds are queried
     * @return the external funds truly available
     */
    function externalBalance(address buyer) public view override returns (uint256) {
        uint256 approved = allowance(buyer);
        uint256 erc20Balance = erc20BalanceOf(buyer);
        return (approved < erc20Balance) ? approved : erc20Balance;
    }
}
