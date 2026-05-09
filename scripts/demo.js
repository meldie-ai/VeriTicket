/**
 * VeriTicket end-to-end demo script.
 *
 * Run with:
 *     npx hardhat run scripts/demo.js
 *
 * Walks through every stakeholder action:
 *
 *   1. Admin approves Organiser, registers Staff, wires up TransferContract.
 *   2. Organiser creates an event and mints a ticket to Buyer A.
 *   3. Buyer A approves the marketplace and lists the ticket within the cap.
 *   4. Buyer B funds USDC, approves spending, and purchases.
 *   5. Staff redeems the ticket using a one-time challenge signed by Buyer B.
 *   6. Re-redemption / re-listing / transfer of the redeemed ticket all fail.
 *
 */

const hre = require("hardhat");
const { ethers } = hre;

const USDC = (n) => ethers.parseUnits(n, 6);

function banner(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const [admin, organizer, staff, buyerA, buyerB] = await ethers.getSigners();

  banner("Deploying contracts");
  const Ticket = await ethers.getContractFactory("TicketContract");
  const ticketContract = await Ticket.deploy(admin.address);
  await ticketContract.waitForDeployment();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const Transfer = await ethers.getContractFactory("TransferContract");
  const transferContract = await Transfer.deploy(
    admin.address,
    await ticketContract.getAddress(),
    await usdc.getAddress()
  );
  await transferContract.waitForDeployment();

  await ticketContract.setTransferContract(await transferContract.getAddress());

  console.log("Admin:            ", admin.address);
  console.log("Organizer:        ", organizer.address);
  console.log("Staff:            ", staff.address);
  console.log("Buyer A:          ", buyerA.address);
  console.log("Buyer B:          ", buyerB.address);
  console.log("TicketContract:   ", await ticketContract.getAddress());
  console.log("TransferContract: ", await transferContract.getAddress());
  console.log("MockUSDC:         ", await usdc.getAddress());

  // --------------------------------------------------------------------------
  banner("1. Admin onboards organiser and staff");
  await ticketContract.connect(admin).approveOrganizer(organizer.address);
  console.log("  Granted ORGANIZER_ROLE to organizer");
  await ticketContract.connect(admin).addStaff(staff.address);
  console.log("  Granted STAFF_ROLE to staff");

  // --------------------------------------------------------------------------
  banner("2. Organiser creates event and mints ticket #1 to Buyer A");
  await ticketContract.connect(organizer).createEvent(
    "QUT Stadium Concert",
    Math.floor(Date.now() / 1000) + 30 * 86400,
    100,
    USDC("50"),
    USDC("75"),
    4
  );
  await ticketContract.connect(organizer).mintTicket(1, buyerA.address);
  console.log("  Event 1 created (cap = 75 USDC, per-wallet limit = 4)");
  console.log("  Ticket 1 minted ->", buyerA.address);
  console.log("  ownerOf(1) =", await ticketContract.ownerOf(1));

  // --------------------------------------------------------------------------
  banner("3. Buyer A lists ticket #1 for resale at 70 USDC");
  await ticketContract.connect(buyerA).approve(await transferContract.getAddress(), 1);
  await transferContract.connect(buyerA).listTicket(1, USDC("70"));
  const listing = await transferContract.getActiveListing(1);
  console.log("  Active:", listing.active, "Seller:", listing.seller, "Price (USDC):", ethers.formatUnits(listing.price, 6));

  // --------------------------------------------------------------------------
  banner("4. Buyer B funds USDC, approves marketplace, and purchases");
  await usdc.mint(buyerB.address, USDC("200"));
  await usdc.connect(buyerB).approve(await transferContract.getAddress(), ethers.MaxUint256);

  const sellerBefore = await usdc.balanceOf(buyerA.address);
  const buyerBefore = await usdc.balanceOf(buyerB.address);
  await transferContract.connect(buyerB).purchaseTicket(1);
  const sellerAfter = await usdc.balanceOf(buyerA.address);
  const buyerAfter = await usdc.balanceOf(buyerB.address);

  console.log("  ownerOf(1) =", await ticketContract.ownerOf(1));
  console.log("  Seller USDC delta = +", ethers.formatUnits(sellerAfter - sellerBefore, 6));
  console.log("  Buyer  USDC delta = ", ethers.formatUnits(buyerAfter - buyerBefore, 6));

  // --------------------------------------------------------------------------
  banner("5. Staff redeems ticket #1 with Buyer B's signed challenge");
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const digest = await ticketContract.redemptionDigest(1, nonce);
  const sig = await buyerB.signMessage(ethers.getBytes(digest));
  await ticketContract.connect(staff).redeemTicket(1, nonce, sig);
  console.log("  Redeemed. isRedeemed(1) =", await ticketContract.isRedeemed(1));

  // --------------------------------------------------------------------------
  banner("6. Post-redemption locks");
  try {
    await ticketContract.connect(buyerB).transferFrom(buyerB.address, buyerA.address, 1);
    console.log("  Transfer succeeded (this should not happen)");
  } catch (e) {
    console.log("  Transfer of redeemed ticket reverted as expected:", e.shortMessage || e.message);
  }
  try {
    await ticketContract.connect(buyerB).approve(await transferContract.getAddress(), 1);
    await transferContract.connect(buyerB).listTicket(1, USDC("60"));
    console.log("  Re-listing succeeded (this should not happen)");
  } catch (e) {
    console.log("  Re-listing reverted as expected:    ", e.shortMessage || e.message);
  }

  banner("Demo complete");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
