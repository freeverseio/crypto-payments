// SPDX-License-Identifier: MIT
pragma solidity =0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Management of Fees Collectors.
 * @author Freeverse.io, www.freeverse.io
 * @dev FeesCollectors are just the addresses to which fees
 * are paid when payments are successfully completed.
 *
 * The constructor sets a defaultFeesCollector = deployer.
 * The owner of the contract can change the defaultFeesCollector.
 *
 * The owner of the contract can assign explicit feesCollectors to each universe.
 * If a universe does not have an explicitly assigned feesCollector,
 * the default feesCollector is used.
 */

contract FeesCollectors is Ownable {
    /**
     * @dev Event emitted on change of default feesCollector
     * @param feesCollector The address of the new default feesCollector
     */
    event DefaultFeesCollector(address indexed feesCollector);

    /**
     * @dev Event emitted on change of a specific universe feesCollector
     * @param universeId The id of the universe
     * @param feesCollector The address of the new universe feesCollector
     */
    event UniverseFeesCollector(uint256 indexed universeId, address indexed feesCollector);

    /// @dev The address of the default feesCollector:
    address private _defaultFeesCollector;

    /// @dev The mapping from universeId to specific universe feesCollector:
    mapping(uint256 => address) private _universeFeesCollectors;

    constructor() {
        _defaultFeesCollector = msg.sender;
        emit DefaultFeesCollector(msg.sender);
    }

    /**
     * @dev Sets a new default feesCollector
     * @param feesCollector The address of the new default feesCollector
     */
    function setDefaultFeesCollector(address feesCollector) external onlyOwner {
        _defaultFeesCollector = feesCollector;
        emit DefaultFeesCollector(feesCollector);
    }

    /**
     * @dev Sets a new specific universe feesCollector
     * @param universeId The id of the universe
     * @param feesCollector The address of the new universe feesCollector
     */
    function setUniverseFeesCollector(uint256 universeId, address feesCollector)
        external
        onlyOwner
    {
        _universeFeesCollectors[universeId] = feesCollector;
        emit UniverseFeesCollector(universeId, feesCollector);
    }

    /**
     * @dev Removes a specific universe feesCollector
     * @notice The universe will then have fees collected by _defaultFeesCollector
     * @param universeId The id of the universe
     */
    function removeUniverseFeesCollector(uint256 universeId)
        external
        onlyOwner
    {
        delete _universeFeesCollectors[universeId];
        emit UniverseFeesCollector(universeId, _defaultFeesCollector);
    }

    /**
     * @dev Returns the default feesCollector
     */
    function defaultFeesCollector() external view returns (address) {
        return _defaultFeesCollector;
    }

    /**
     * @dev Returns the feesCollector of a specific universe
     * @param universeId The id of the universe
     */
    function universeFeesCollector(uint256 universeId)
        public
        view
        returns (address)
    {
        address storedFeesCollector = _universeFeesCollectors[universeId];
        return
            storedFeesCollector == address(0)
                ? _defaultFeesCollector
                : storedFeesCollector;
    }
}
