// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Only the two TicketContract functions this contract actually calls.
///         Interface instead of a full import — no need to pull in the whole contract.
interface ITicketContract is IERC721 {
    /// @notice Returns the maximum permitted resale price for a ticket (USDC, 6 decimals).
    function maxResalePriceFor(uint256 ticketId) external view returns (uint256);

    /// @notice Returns true if the ticket has already been redeemed at the venue.
    function isRedeemed(uint256 ticketId) external view returns (bool);
}

/// @title  TransferContract
/// @notice Resale marketplace for VeriTicket NFT tickets.
///
///         Notes:
///         - Ownable not AccessControl — only one privileged action (pause), no need for roles.
///         - nonReentrant on purchaseTicket() only. That's the only function doing an external
///           call (USDC transferFrom) before state updates. Guarding everything else wastes gas.
///         - Sellers keep the NFT until purchase. No escrow — standard approve/transferFrom.
///         - Resale cap is fetched from TicketContract at listing time, not cached here.
///           Caching it would let a stale value stick around if the organiser updated it.
///         - USDC and NFT move in the same tx. One reverts, both revert — no partial fills.
contract TransferContract is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Immutable references ───────────────────────────────────────────────────

    /// @notice The TicketContract whose NFTs are traded on this marketplace.
    ITicketContract public immutable ticketContract;

    /// @notice ERC-20 used for payments (USDC, 6 decimals). MATIC wasn't suitable —
    ///         ticket prices in a volatile asset make no sense for fixed-price events.
    IERC20 public immutable paymentToken;

    // ── Data structures ───────────────────────────────────────────────────────

    /// @notice Represents an active or historical resale listing for a single ticket.
    struct Listing {
        address seller;  // Wallet that created the listing; must still own the ticket at purchase time.
        uint256 price;   // Agreed sale price in USDC (6 decimals).
        bool    active;  // False once the listing is cancelled or the ticket is purchased.
    }

    mapping(uint256 => Listing) private _listings;

    // ── Events ────────────────────────────────────────────────────────────────

    event TicketListed(uint256 indexed ticketId, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed ticketId, address indexed seller);
    event TicketPurchased(uint256 indexed ticketId, address indexed seller, address indexed buyer, uint256 price);

    // ── Custom errors ─────────────────────────────────────────────────────────

    error NotTicketOwner();
    error NotApproved();
    error PriceMustBePositive();
    error ResaleCapExceeded(uint256 attempted, uint256 cap);
    error TicketAlreadyRedeemed(uint256 ticketId);
    error NoActiveListing(uint256 ticketId);
    error CannotBuyOwnTicket();

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @notice Deploy the marketplace.
    /// @param  admin                 Platform admin wallet.
    /// @param  ticketContractAddress Deployed TicketContract address.
    /// @param  paymentTokenAddress   USDC token address.
    constructor(address admin, address ticketContractAddress, address paymentTokenAddress)
        Ownable(admin)
    {
        ticketContract = ITicketContract(ticketContractAddress);
        paymentToken = IERC20(paymentTokenAddress);
    }

<<<<<<< HEAD
    // Pause and unpase the contract ADMIN ONLY
=======
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Pause listings and purchases. Cancel listing stays open so
    ///         sellers aren't stuck during an emergency.
>>>>>>> fb266cd (Add NatSpec docs, grant admin UI, updated README)
    function pause() external onlyOwner { _pause(); }

    /// @notice Resume normal operation.
    function unpause() external onlyOwner { _unpause(); }

<<<<<<< HEAD
    // List owned ticket for resale with max price dictated by maxResalePriceFor
=======
    // ── Seller actions ────────────────────────────────────────────────────────

    /// @notice List a ticket for resale. Caller must own the ticket and have
    ///         approved this contract to move it. Price is checked against the
    ///         on-chain cap — can't bypass it by going directly to the contract.
    /// @param  ticketId Token id to list.
    /// @param  price    Sale price in USDC (6 decimals). Must be > 0 and <= resale cap.
>>>>>>> fb266cd (Add NatSpec docs, grant admin UI, updated README)
    function listTicket(uint256 ticketId, uint256 price) external whenNotPaused {
        if (ticketContract.ownerOf(ticketId) != msg.sender) revert NotTicketOwner();
        if (price == 0) revert PriceMustBePositive();
        if (ticketContract.isRedeemed(ticketId)) revert TicketAlreadyRedeemed(ticketId);

        uint256 cap = ticketContract.maxResalePriceFor(ticketId);
        if (price > cap) revert ResaleCapExceeded(price, cap);

        // Validate approval at listing time rather than at purchase time so the
        // buyer cannot be misled into purchasing a listing that would immediately fail.
        if (
            ticketContract.getApproved(ticketId) != address(this) &&
            !ticketContract.isApprovedForAll(msg.sender, address(this))
        ) {
            revert NotApproved();
        }

        _listings[ticketId] = Listing({seller: msg.sender, price: price, active: true});
        emit TicketListed(ticketId, msg.sender, price);
    }

<<<<<<< HEAD
    // Cancel active listing of owned ticket
=======
    /// @notice Cancel a listing. No pause check — sellers should always be able to delist.
    /// @param  ticketId Token id to delist.
>>>>>>> fb266cd (Add NatSpec docs, grant admin UI, updated README)
    function cancelListing(uint256 ticketId) external {
        Listing storage l = _listings[ticketId];
        if (!l.active) revert NoActiveListing(ticketId);
        if (l.seller != msg.sender) revert NotTicketOwner();
        l.active = false;
        emit ListingCancelled(ticketId, msg.sender);
    }

    // ── Buyer actions ─────────────────────────────────────────────────────────

    /// @notice Buy a listed ticket. USDC and NFT swap atomically — if either leg
    ///         fails, the whole tx reverts. nonReentrant covers the gap between the
    ///         USDC transferFrom and the NFT transferFrom.
    /// @param  ticketId Token id to purchase.
    function purchaseTicket(uint256 ticketId) external nonReentrant whenNotPaused {
        Listing storage l = _listings[ticketId];
        if (!l.active) revert NoActiveListing(ticketId);
        if (l.seller == msg.sender) revert CannotBuyOwnTicket();
        if (ticketContract.isRedeemed(ticketId)) revert TicketAlreadyRedeemed(ticketId);

        // Re-validate ownership: the seller may have transferred the ticket out-of-band
        // after listing it, leaving a stale listing. This prevents the buyer from paying
        // for a ticket the seller no longer holds.
        if (ticketContract.ownerOf(ticketId) != l.seller) revert NotTicketOwner();

        uint256 price  = l.price;
        address seller = l.seller;
        l.active = false; // Mark inactive before external calls (checks-effects-interactions).

        paymentToken.safeTransferFrom(msg.sender, seller, price);
        ticketContract.transferFrom(seller, msg.sender, ticketId);

        emit TicketPurchased(ticketId, seller, msg.sender, price);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Current listing state for a ticket.
    /// @param  ticketId Token id to query.
    /// @return active   True if listing is live.
    /// @return seller   Wallet that created the listing.
    /// @return price    Listed price in USDC (6 decimals).
    function getActiveListing(uint256 ticketId) external view returns (
        bool active, address seller, uint256 price
    ) {
        Listing storage l = _listings[ticketId];
        return (l.active, l.seller, l.price);
    }
}
