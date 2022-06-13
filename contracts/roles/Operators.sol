// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Management of Operators.
 * @author Freeverse.io, www.freeverse.io
 * @dev The Operator role is to execute the actions required when
 * payments arrive to this contract, and then either
 * confirm the success of those actions, or confirm the failure.
 * All parties agree explicitly on a specific address to 
 * act as an Operator for each individual payment process. 
 *
 * The constructor sets a defaultOperator = deployer.
 * The owner of the contract can change the defaultOperator.
 *
 * The owner of the contract can assign explicit operators to each universe.
 * If a universe does not have an explicitly assigned operator,
 * the default operator is used.
 */

contract Operators is Ownable {
    /**
     * @dev Event emitted on change of default operator
     * @param operator The address of the new default operator
     */
    event DefaultOperator(address indexed operator);

    /**
     * @dev Event emitted on change of a specific universe operator
     * @param universeId The id of the universe
     * @param operator The address of the new universe operator
     */
    event UniverseOperator(uint256 indexed universeId, address indexed operator);

    /// @dev The address of the default operator:
    address private _defaultOperator;

    /// @dev The mapping from universeId to specific universe operator:
    mapping(uint256 => address) private _universeOperators;

    constructor() {
        _defaultOperator = msg.sender;
        emit DefaultOperator(msg.sender);
    }

    /**
     * @dev Sets a new default operator
     * @param operator The address of the new default operator
     */
    function setDefaultOperator(address operator) external onlyOwner {
        _defaultOperator = operator;
        emit DefaultOperator(operator);
    }

    /**
     * @dev Sets a new specific universe operator
     * @param universeId The id of the universe
     * @param operator The address of the new universe operator
     */
    function setUniverseOperator(uint256 universeId, address operator)
        external
        onlyOwner
    {
        _universeOperators[universeId] = operator;
        emit UniverseOperator(universeId, operator);
    }

    /**
     * @dev Removes a specific universe operator
     * @notice The universe will then be operated by _defaultOperator
     * @param universeId The id of the universe
     */
    function removeUniverseOperator(uint256 universeId) external onlyOwner {
        delete _universeOperators[universeId];
        emit UniverseOperator(universeId, _defaultOperator);
    }

    /**
     * @dev Returns the default operator
     */
    function defaultOperator() external view returns (address) {
        return _defaultOperator;
    }

    /**
     * @dev Returns the operator of a specific universe
     * @param universeId The id of the universe
     */
    function universeOperator(uint256 universeId)
        public
        view
        returns (address)
    {
        address storedOperator = _universeOperators[universeId];
        return storedOperator == address(0) ? _defaultOperator : storedOperator;
    }
}
