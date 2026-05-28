// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title  TicketContract
/// @notice ERC-721 ticket NFT for VeriTicket. Three roles (admin, organiser, staff),
///         a per-event resale cap and per-wallet limit, and a challenge-response
///         redemption flow that defeats screenshotted QR codes.
contract TicketContract is ERC721, AccessControl, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant STAFF_ROLE = keccak256("STAFF_ROLE");

    struct Event {
        address organizer;
        string name;
        uint64 eventDate;
        uint32 ticketSupply;
        uint32 ticketsMinted;
        uint256 primaryPrice;    // USDC, 6 decimals
        uint256 maxResalePrice;  // USDC, 6 decimals, enforced by TransferContract
        uint16 perWalletLimit;   // 0 = unlimited
        bool exists;
    }

    struct Ticket {
        uint256 eventId;
        bool redeemed;
    }

    uint256 public nextEventId = 1;
    uint256 public nextTicketId = 1;

    mapping(uint256 => Event) private _events;
    mapping(uint256 => Ticket) private _tickets;

    /// Active (un-redeemed) tickets each wallet holds for a given event.
    /// Decremented on redemption so attending one show doesn't lock the buyer
    /// out of holding another ticket for the same event later.
    mapping(uint256 => mapping(address => uint256)) public walletEventCount;

    /// keccak256(ticketId, nonce) of every consumed redemption challenge.
    mapping(bytes32 => bool) public usedNonces;

    /// Published address of the resale marketplace; set by admin after deploy.
    address public transferContract;

    event EventCreated(uint256 indexed eventId, address indexed organizer, string name, uint32 ticketSupply);
    event TicketMinted(uint256 indexed ticketId, uint256 indexed eventId, address indexed buyer);
    event TicketRedeemed(uint256 indexed ticketId, address indexed staff, address indexed owner);
    event OrganizerApproved(address indexed account);
    event OrganizerRevoked(address indexed account);
    event StaffAdded(address indexed account);
    event StaffRemoved(address indexed account);
    event TransferContractUpdated(address indexed previous, address indexed current);

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

    constructor(address admin) ERC721("VeriTicket", "VTKT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // Grant a wallet address the organizer role ADMIN ONLY
    function approveOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(ORGANIZER_ROLE, organizer);
        emit OrganizerApproved(organizer);
    }

    // Revoke organizer privileges from wallet ADMIN ONLY
    function revokeOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ORGANIZER_ROLE, organizer);
        emit OrganizerRevoked(organizer);
    }

    // Grant a wallet address the staff role ADMIN ONLY
    function addStaff(address staff) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(STAFF_ROLE, staff);
        emit StaffAdded(staff);
    }

    // Revoke staff privileges from wallet ADMIN ONLY
    function removeStaff(address staff) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(STAFF_ROLE, staff);
        emit StaffRemoved(staff);
    }

    function setTransferContract(address newTransferContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit TransferContractUpdated(transferContract, newTransferContract);
        transferContract = newTransferContract;
    }

    // Pause and unpase the contract ADMIN ONLY
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // Create an event with an event name, date, total number of tickets, primary price, max resale price and max tickets per wallet ORGANIZER ONLY
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

    /// Primary-sale mint. Payment is collected off-chain by the organiser
    /// (Stripe / fiat-on-ramp); this call only records ownership.
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

    /// Digest the ticket owner signs to authorise a single redemption attempt.
    /// Domain-separated by chain id and contract address so the signature
    /// cannot be replayed against another deployment.
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

    // Used by staff role at door of event to verify and redeem tickets 
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

    // Returns max resale price for specified ticket
    function maxResalePriceFor(uint256 ticketId) external view returns (uint256) {
        Ticket storage t = _tickets[ticketId];
        if (t.eventId == 0) revert TicketDoesNotExist(ticketId);
        return _events[t.eventId].maxResalePrice;
    }

    // Returns if ticket has been redeemed
    function isRedeemed(uint256 ticketId) external view returns (bool) {
        return _tickets[ticketId].redeemed;
    }

    // Returns specified event details given a event ID
    function getEventDetails(uint256 eventId) external view returns (Event memory) {
        if (!_events[eventId].exists) revert EventDoesNotExist(eventId);
        return _events[eventId];
    }

    // Returns specified ticket details given a ticket ID
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

    /// Single chokepoint for every ownership change: pause guard, redeemed-lock,
    /// per-wallet cap on the receiver, and bookkeeping. Applies equally to
    /// primary mints and resale transfers.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);

        _requireNotPaused();

        if (from != address(0) && _tickets[tokenId].redeemed) {
            revert TicketAlreadyRedeemed(tokenId);
        }

        uint256 eventId = _tickets[tokenId].eventId;

        if (from != address(0) && to != address(0)) {
            uint16 limit = _events[eventId].perWalletLimit;
            if (limit != 0 && walletEventCount[eventId][to] >= limit) {
                revert PerWalletLimitExceeded(eventId, to);
            }
            walletEventCount[eventId][from] -= 1;
            walletEventCount[eventId][to] += 1;
        } else if (from == address(0) && to != address(0)) {
            walletEventCount[eventId][to] += 1;
        } else if (to == address(0) && from != address(0)) {
            walletEventCount[eventId][from] -= 1;
        }

        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
