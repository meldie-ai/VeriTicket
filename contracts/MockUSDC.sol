// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  MockUSDC
/// @notice 6-decimal ERC-20 used for local tests. Anyone can mint freely, do
///         not deploy to a public network. On Polygon, point TransferContract
///         at the real USDC address (0x3c499c542cef5e3811e1192ce70d8cc03d5c3359)
///         instead of this contract.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
