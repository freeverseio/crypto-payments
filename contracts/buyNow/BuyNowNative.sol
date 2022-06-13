// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "./IBuyNowNative.sol";
import "./base/BuyNowBase.sol";

/**
 * @title Escrow Contract for Payments in BuyNow mode, in Native Cryptocurrency.
 * @author Freeverse.io, www.freeverse.io
 * @notice Full contract documentation in IBuyNowNative
 */

contract BuyNowNative is IBuyNowNative, BuyNowBase {

    constructor(string memory currencyDescriptor, address eip712) BuyNowBase(currencyDescriptor, eip712) {}

    /// @inheritdoc IBuyNowNative
    function buyNow(
        BuyNowInput calldata buyNowInp,
        bytes calldata operatorSignature
    ) external payable {
        require(
            msg.sender == buyNowInp.buyer,
            "only buyer can execute this function"
        );
        address operator = universeOperator(buyNowInp.universeId);
        require(
            IEIP712VerifierBuyNow(_eip712).verifyBuyNow(buyNowInp, operatorSignature, operator),
            "incorrect operator signature"
        );
        // The following requirement avoids possible mistakes in building the TX's msg.value.
        // While the funds provided can by less than the asset price (in case of payer having local balance),
        // there is no reason for providing more funds than the asset price.
        require(
            (msg.value <= buyNowInp.amount),
            "new funds provided must be less than bid amount"
        );
        _processBuyNow(buyNowInp, operator);
    }

    // PRIVATE & INTERNAL FUNCTIONS

    /**
     * @dev Updates payer's local balance, re-using it if possible, and adding excess of provided funds, if any.
     *  It is difficult to predict the exact msg.value required at the moment of submitting a payment,
     *  because localFunds may have just increased due to an asynchronously finished sale by the payer.
     *  Any possible excess of provided funds is moved to payer's local balance.
     * @param payer The address executing the payment
     * @param newFundsNeeded The elsewhere computed minimum amount of funds required to be provided by the payer,
     *  having possible re-use of local funds into account
     * @param localFunds The elsewhere computed amount of funds available to the payer in this contract that will be
     *  re-used in the payment
     */
    function _updatePayerBalanceOnPaymentReceived(
        address payer,
        uint256 newFundsNeeded,
        uint256 localFunds
    ) internal override {
        require(
            (msg.value >= newFundsNeeded),
            "new funds provided are not within required range"
        );
        // The next operation can never underflow due to the previous constraint,
        // and to the fact that splitFundingSources guarantees that _balanceOf[payer] >= localFunds
        _balanceOf[payer] = (_balanceOf[payer] + msg.value) - newFundsNeeded - localFunds;
    }

    /**
     * @dev Transfers the specified amount to the specified address.
     *  Requirements and effects (e.g. balance updates) are performed
     *  before calling this function.
     * @param to The address that must receive the funds.
     * @param amount The amount to transfer.
    */
    function _transfer(address to, uint256 amount) internal override {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Address: unable to send value, recipient may have reverted");
    }

    // VIEW FUNCTIONS

    /**
     * @notice Returns the amount available to a buyer outside this contract
     * @param buyer The address for which funds are queried
     * @return the external funds available
     */
    function externalBalance(address buyer) public view override returns (uint256) {
        return buyer.balance;
    }
}
