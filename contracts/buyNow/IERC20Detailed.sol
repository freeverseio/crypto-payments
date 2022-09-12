// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

/**
 * @title Interface to optional methods from the ERC20 standard.
 * @author Freeverse.io, www.freeverse.io
 */

interface IERC20Detailed {
    /**
     * @notice Returns the name of the token.
     * @return the name of the token
     */
    function name() external view returns (string memory);

    /**
     * @notice Returns the symbol of the token, usually a shorter version of the
     * name.
     * @return the symbol of the token
     */
    function symbol() external view returns (string memory);

    /**
     * @notice Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     * @return the number of decimals
     */
    function decimals() external view returns (uint8);
}
