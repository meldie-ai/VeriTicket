// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITicketContract is IERC721 {
    function maxResalePriceFor(uint256 ticketId) external view returns (uint256);
    function isRedeemed(uint256 ticketId) external view returns (bool);
}

/// @title  TransferContract
/// @notice Resale marketplace for VeriTicket NFTs. Reads the per-event resale
///         cap from TicketContract and atomically swaps USDC for the NFT.
///         Sellers keep custody until purchase, via the standard ERC-721
///         approve()-then-transferFrom() pattern.
contract TransferContract is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ITicketContract public immutable ticketContract;
    IERC20 public immutable paymentToken; // USDC, 6 decimals on Polygon

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) private _listings;

    event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed ticketId, address indexed seller);
    event TicketPurchased(uint256 indexed ticketId, address indexed seller, address indexed buyer, uint256 price);

    error NotTicketOwner();
    error NotApproved();
    error PriceMustBePositive();
    error ResaleCapExceeded(uint256 attempted, uint256 cap);
    error TicketAlreadyRedeemed(uint256 ticketId);
    error NoActiveListing(uint256 ticketId);
    error CannotBuyOwnTicket();

    constructor(address admin, address ticketContractAddress, address paymentTokenAddress)
        Ownable(admin)
    {
        ticketContract = ITicketContract(ticketContractAddress);
        paymentToken = IERC20(paymentTokenAddress);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function listTicket(uint256 ticketId, uint256 price) external whenNotPaused {
        if (ticketContract.ownerOf(ticketId) != msg.sender) revert NotTicketOwner();
        if (price == 0) revert PriceMustBePositive();
        if (ticketContract.isRedeemed(ticketId)) revert TicketAlreadyRedeemed(ticketId);

        uint256 cap = ticketContract.maxResalePriceFor(ticketId);
        if (price > cap) revert ResaleCapExceeded(price, cap);

        // Without prior approval, purchaseTicket() can't move the NFT later, so
        // catch the missing approval at listing time rather than at sale time.
        if (
            ticketContract.getApproved(ticketId) != address(this) &&
            !ticketContract.isApprovedForAll(msg.sender, address(this))
        ) {
            revert NotApproved();
        }

        _listings[ticketId] = Listing({seller: msg.sender, price: price, active: true});
        emit TicketListed(ticketId, msg.sender, price);
    }

    function cancelListing(uint256 ticketId) external {
        Listing storage l = _listings[ticketId];
        if (!l.active) revert NoActiveListing(ticketId);
        if (l.seller != msg.sender) revert NotTicketOwner();
        l.active = false;
        emit ListingCancelled(ticketId, msg.sender);
    }

    /// Atomic settlement: USDC moves and the NFT moves in the same transaction.
    /// If either leg reverts, the whole call reverts and nothing changes.
    function purchaseTicket(uint256 ticketId) external nonReentrant whenNotPaused {
        Listing storage l = _listings[ticketId];
        if (!l.active) revert NoActiveListing(ticketId);
        if (l.seller == msg.sender) revert CannotBuyOwnTicket();
        if (ticketContract.isRedeemed(ticketId)) revert TicketAlreadyRedeemed(ticketId);
        // Re-check ownership: the seller could have moved the ticket directly
        // after listing it, leaving a stale listing behind.
        if (ticketContract.ownerOf(ticketId) != l.seller) revert NotTicketOwner();

        uint256 price = l.price;
        address seller = l.seller;
        l.active = false;

        paymentToken.safeTransferFrom(msg.sender, seller, price);
        ticketContract.transferFrom(seller, msg.sender, ticketId);

        emit TicketPurchased(ticketId, seller, msg.sender, price);
    }

    function getActiveListing(uint256 ticketId) external view returns (
        bool active, address seller, uint256 price
    ) {
        Listing storage l = _listings[ticketId];
        return (l.active, l.seller, l.price);
    }
}
