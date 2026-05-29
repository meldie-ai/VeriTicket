// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title  TicketContract
/// @notice ERC-721 NFT tickets for VeriTicket.
///
///         Notes:
///         - Three roles (admin, organiser, staff) — Ownable wasn't enough since
///           each role needs to be granted/revoked independently.
///         - Resale cap lives on-chain so TransferContract can read it directly.
///           Storing it in the frontend would be trivial to bypass.
///         - Redemption uses a signed nonce (challenge-response) not just ownerOf().
///           A screenshot of a QR code passes an ownerOf() check; it can't forge a sig.
///         - All transfer rules go in _update() so they cover transferFrom,
///           safeTransferFrom, and mints — overriding just transferFrom would miss the others.
contract TicketContract is ERC721, AccessControl, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ── Roles ─────────────────────────────────────────────────────────────────

    /// @notice Role identifier for approved event organisers.
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");

    /// @notice Role identifier for venue door staff authorised to redeem tickets.
    bytes32 public constant STAFF_ROLE = keccak256("STAFF_ROLE");

    // ── Data structures ───────────────────────────────────────────────────────

    /// @notice All metadata for a single event created by an organiser.
    struct Event {
        address organizer;       // Wallet that created the event; only they can mint tickets for it.
        string  name;
        uint64  eventDate;       // Unix timestamp of the event start time.
        uint32  ticketSupply;    // Maximum number of tickets that can be minted.
        uint32  ticketsMinted;   // Running count of tickets issued so far.
        uint256 primaryPrice;    // Face-value price in USDC (6 decimals).
        uint256 maxResalePrice;  // Hard ceiling for secondary-market listings, enforced by TransferContract.
        uint16  perWalletLimit;  // Maximum tickets one wallet may hold for this event; 0 = unlimited.
        bool    exists;          // Guard flag so unmapped eventIds are detectable.
    }

    /// @notice Per-token metadata linking each NFT to its parent event.
    struct Ticket {
        uint256 eventId;  // The event this ticket belongs to.
        bool    redeemed; // True once the ticket has been scanned at the door; permanently locked thereafter.
    }

    // ── State ─────────────────────────────────────────────────────────────────

    /// @notice Monotonically increasing counter; the next event will be assigned this id.
    uint256 public nextEventId = 1;

    /// @notice Monotonically increasing counter; the next minted ticket will receive this token id.
    uint256 public nextTicketId = 1;

    mapping(uint256 => Event)  private _events;
    mapping(uint256 => Ticket) private _tickets;

    /// @notice Number of active (un-redeemed) tickets a wallet holds for a given event.
    ///         Decremented on redemption so past attendance does not permanently consume a wallet slot.
    mapping(uint256 => mapping(address => uint256)) public walletEventCount;

    /// @notice Tracks consumed redemption challenges keyed by keccak256(ticketId, nonce).
    ///         Prevents the same signed nonce from being replayed against the same ticket.
    mapping(bytes32 => bool) public usedNonces;

    /// @notice Address of the authorised resale marketplace (TransferContract).
    ///         Stored for informational purposes; the marketplace is trusted via ERC-721 approval.
    address public transferContract;

    // ── Events ────────────────────────────────────────────────────────────────

    event EventCreated(uint256 indexed eventId, address indexed organizer, string name, uint32 ticketSupply);
    event TicketMinted(uint256 indexed ticketId, uint256 indexed eventId, address indexed buyer);
    event TicketRedeemed(uint256 indexed ticketId, address indexed staff, address indexed owner);
    event OrganizerApproved(address indexed account);
    event OrganizerRevoked(address indexed account);
    event StaffAdded(address indexed account);
    event StaffRemoved(address indexed account);
    event TransferContractUpdated(address indexed previous, address indexed current);

    // ── Custom errors ─────────────────────────────────────────────────────────

    error EventDoesNotExist(uint256 eventId);
    error TicketDoesNotExist(uint256 ticketId);
    error SoldOut(uint256 eventId);
    error PerWalletLimitExceeded(uint256 eventId, address wallet);
    error TicketAlreadyRedeemed(uint256 ticketId);
    error InvalidSignature();
    error NonceAlreadyUsed(bytes32 nonceKey);
    error NotEventOrganizer();
    error InvalidPrimaryPrice();
    error InvalidResaleCap();

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @notice Deploys the contract and grants DEFAULT_ADMIN_ROLE to `admin`.
    /// @param  admin The platform administrator wallet address.
    constructor(address admin) ERC721("VeriTicket", "VTKT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ── Admin: role management ────────────────────────────────────────────────

    /// @notice Grant ORGANIZER_ROLE to an address.
    /// @param  organizer Wallet to approve.
    function approveOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(ORGANIZER_ROLE, organizer);
        emit OrganizerApproved(organizer);
    }

    /// @notice Revoke ORGANIZER_ROLE from an address.
    /// @param  organizer Wallet to revoke.
    function revokeOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ORGANIZER_ROLE, organizer);
        emit OrganizerRevoked(organizer);
    }

    /// @notice Grant STAFF_ROLE to an address.
    /// @param  staff Wallet to approve.
    function addStaff(address staff) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(STAFF_ROLE, staff);
        emit StaffAdded(staff);
    }

    /// @notice Revoke STAFF_ROLE from an address.
    /// @param  staff Wallet to revoke.
    function removeStaff(address staff) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(STAFF_ROLE, staff);
        emit StaffRemoved(staff);
    }

    /// @notice Store the TransferContract address. Informational only — no special
    ///         permissions are granted here; buyers still approve the marketplace themselves.
    /// @param  newTransferContract Deployed TransferContract address.
    function setTransferContract(address newTransferContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit TransferContractUpdated(transferContract, newTransferContract);
        transferContract = newTransferContract;
    }

    /// @notice Freeze everything — event creation, minting, transfers, redemptions.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }

    /// @notice Resume normal operation.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Organiser: event & ticket management ──────────────────────────────────

    /// @notice Create an event. ORGANIZER_ROLE only.
    /// @param  name           Event name.
    /// @param  eventDate      Unix timestamp of event start.
    /// @param  ticketSupply   Max tickets that can be minted.
    /// @param  primaryPrice   Face-value price in USDC (6 decimals). Must be > 0.
    /// @param  maxResalePrice Resale ceiling read by TransferContract. Must be >= primaryPrice.
    /// @param  perWalletLimit Max tickets per wallet. 0 = no limit.
    /// @return eventId        New event id (starts at 1).
    function createEvent(
        string calldata name,
        uint64 eventDate,
        uint32 ticketSupply,
        uint256 primaryPrice,
        uint256 maxResalePrice,
        uint16 perWalletLimit
    ) external whenNotPaused onlyRole(ORGANIZER_ROLE) returns (uint256 eventId) {
        if (primaryPrice == 0) revert InvalidPrimaryPrice();
        if (maxResalePrice < primaryPrice) revert InvalidResaleCap();

        eventId = nextEventId++;
        _events[eventId] = Event({
            organizer: msg.sender,
            name: name,
            eventDate: eventDate,
            ticketSupply: ticketSupply,
            ticketsMinted: 0,
            primaryPrice: primaryPrice,
            maxResalePrice: maxResalePrice,
            perWalletLimit: perWalletLimit,
            exists: true
        });
        emit EventCreated(eventId, msg.sender, name, ticketSupply);
    }

    /// @notice Mint a ticket for `eventId` to `to`. Only the organiser who created
    ///         the event can call this — other organisers are blocked.
    ///         Payment is collected off-chain; this just records ownership on-chain.
    /// @param  eventId  Event to issue the ticket for.
    /// @param  to       Attendee wallet receiving the ticket.
    /// @return ticketId Token id of the minted ticket.
    function mintTicket(uint256 eventId, address to)
        external
        whenNotPaused
        onlyRole(ORGANIZER_ROLE)
        returns (uint256 ticketId)
    {
        Event storage e = _events[eventId];
        if (!e.exists) revert EventDoesNotExist(eventId);
        if (e.organizer != msg.sender) revert NotEventOrganizer();
        if (e.ticketsMinted >= e.ticketSupply) revert SoldOut(eventId);
        if (e.perWalletLimit != 0 && walletEventCount[eventId][to] >= e.perWalletLimit) {
            revert PerWalletLimitExceeded(eventId, to);
        }

        ticketId = nextTicketId++;
        _tickets[ticketId] = Ticket({eventId: eventId, redeemed: false});
        e.ticketsMinted += 1;

        _safeMint(to, ticketId);
        emit TicketMinted(ticketId, eventId, to);
    }

    // ── Staff: ticket redemption ───────────────────────────────────────────────

    /// @notice Build the digest the ticket owner signs to approve a redemption.
    ///         Includes chainid and address(this) so the sig can't be replayed on
    ///         a different chain or a redeployed contract.
    /// @param  ticketId Token id being redeemed.
    /// @param  nonce    Fresh random bytes32 for this attempt.
    /// @return          Digest to pass to eth_sign / personal_sign.
    function redemptionDigest(uint256 ticketId, bytes32 nonce) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "VeriTicket-Redeem",
                block.chainid,
                address(this),
                ticketId,
                nonce
            )
        );
    }

    /// @notice Redeem a ticket at the door. STAFF_ROLE only.
    ///         Staff generate a nonce, the holder signs it in their wallet app,
    ///         staff submit both here. Verifying the sig proves the holder controls
    ///         the owner wallet — a photo of a QR code can't do that.
    /// @param  ticketId  Token id to redeem.
    /// @param  nonce     Random value the holder signed.
    /// @param  signature EIP-191 sig from the ticket owner over redemptionDigest(ticketId, nonce).
    function redeemTicket(uint256 ticketId, bytes32 nonce, bytes calldata signature)
        external
        whenNotPaused
        onlyRole(STAFF_ROLE)
    {
        Ticket storage t = _tickets[ticketId];
        if (t.eventId == 0) revert TicketDoesNotExist(ticketId);
        if (t.redeemed) revert TicketAlreadyRedeemed(ticketId);

        bytes32 nonceKey = keccak256(abi.encodePacked(ticketId, nonce));
        if (usedNonces[nonceKey]) revert NonceAlreadyUsed(nonceKey);
        usedNonces[nonceKey] = true;

        bytes32 ethSigned = redemptionDigest(ticketId, nonce).toEthSignedMessageHash();
        address signer = ethSigned.recover(signature);
        address currentOwner = ownerOf(ticketId);
        if (signer != currentOwner) revert InvalidSignature();

        t.redeemed = true;
        walletEventCount[t.eventId][currentOwner] -= 1;

        emit TicketRedeemed(ticketId, msg.sender, currentOwner);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    /// @notice Resale cap for a ticket. Called by TransferContract when a listing is created.
    /// @param  ticketId Token id to query.
    /// @return          Max resale price in USDC (6 decimals).
    function maxResalePriceFor(uint256 ticketId) external view returns (uint256) {
        Ticket storage t = _tickets[ticketId];
        if (t.eventId == 0) revert TicketDoesNotExist(ticketId);
        return _events[t.eventId].maxResalePrice;
    }

    /// @notice Check if a ticket has been redeemed.
    /// @param  ticketId Token id to query.
    /// @return          True if already redeemed.
    function isRedeemed(uint256 ticketId) external view returns (bool) {
        return _tickets[ticketId].redeemed;
    }

    /// @notice Fetch full event details.
    /// @param  eventId Event id to query.
    /// @return         Event struct.
    function getEventDetails(uint256 eventId) external view returns (Event memory) {
        if (!_events[eventId].exists) revert EventDoesNotExist(eventId);
        return _events[eventId];
    }

    /// @notice Ticket summary used by the frontend My Tickets view — bundles ticket
    ///         and event fields so the UI doesn't need a second lookup.
    /// @param  ticketId       Token id to query.
    /// @return eventId        Parent event id.
    /// @return ticketOwner    Current owner wallet.
    /// @return redeemed       Whether the ticket has been used.
    /// @return eventName      Event name.
    /// @return eventDate      Unix timestamp of event start.
    /// @return maxResalePrice Resale ceiling in USDC (6 decimals).
    function getTicketDetails(uint256 ticketId) external view returns (
        uint256 eventId,
        address ticketOwner,
        bool redeemed,
        string memory eventName,
        uint64 eventDate,
        uint256 maxResalePrice
    ) {
        Ticket storage t = _tickets[ticketId];
        if (t.eventId == 0) revert TicketDoesNotExist(ticketId);
        Event storage e = _events[t.eventId];
        return (t.eventId, ownerOf(ticketId), t.redeemed, e.name, e.eventDate, e.maxResalePrice);
    }

    // ── Internal: transfer hook ───────────────────────────────────────────────

    /// @notice Runs on every ownership change — mint, transfer, burn.
    ///         Putting rules here means they can't be bypassed through safeTransferFrom
    ///         or any other path. Checks: not paused, not redeemed, receiver under wallet cap.
    ///         Also keeps walletEventCount in sync for all three cases.
    /// @param  to      Recipient (address(0) on burn).
    /// @param  tokenId Token being moved.
    /// @param  auth    Address authorised to move it.
    /// @return         Previous owner.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        _requireNotPaused();

        if (from != address(0) && _tickets[tokenId].redeemed) {
            revert TicketAlreadyRedeemed(tokenId);
        }

        uint256 eventId = _tickets[tokenId].eventId;

        if (from != address(0) && to != address(0)) {
            // Normal transfer: check receiver cap and update both sides.
            uint16 limit = _events[eventId].perWalletLimit;
            if (limit != 0 && walletEventCount[eventId][to] >= limit) {
                revert PerWalletLimitExceeded(eventId, to);
            }
            walletEventCount[eventId][from] -= 1;
            walletEventCount[eventId][to]   += 1;
        } else if (from == address(0) && to != address(0)) {
            // Mint: increment receiver count only.
            walletEventCount[eventId][to] += 1;
        } else if (to == address(0) && from != address(0)) {
            // Burn: decrement sender count only.
            walletEventCount[eventId][from] -= 1;
        }

        return super._update(to, tokenId, auth);
    }

    // ── ERC-165 ───────────────────────────────────────────────────────────────

    /// @notice Supports ERC-721 and AccessControl interface detection.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
