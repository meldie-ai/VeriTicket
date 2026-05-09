const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * End-to-end happy path:
 *   1. Admin approves an organiser and registers a venue staff member.
 *   2. Organiser creates an event and mints a ticket to Buyer A.
 *   3. Buyer A lists the ticket on TransferContract within the resale cap.
 *   4. Buyer B purchases the listing in USDC, ownership flips atomically.
 *   5. Buyer B presents the ticket; staff redeems it via the challenge-response.
 *   6. The ticket can no longer be listed, transferred, or redeemed again.
 */
describe("VeriTicket end-to-end", function () {
  it("walks an NFT ticket through mint -> resale -> redemption", async function () {
    const [admin, organizer, staff, buyerA, buyerB] = await ethers.getSigners();

    // Deploy stack
    const Ticket = await ethers.getContractFactory("TicketContract");
    const ticketContract = await Ticket.deploy(admin.address);
    await ticketContract.waitForDeployment();

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const Transfer = await ethers.getContractFactory("TransferContract");
    const transferContract = await Transfer.deploy(
      admin.address,
      await ticketContract.getAddress(),
      await usdc.getAddress()
    );
    await transferContract.waitForDeployment();

    // Wire the marketplace into TicketContract (informational).
    await ticketContract.connect(admin).setTransferContract(await transferContract.getAddress());
    expect(await ticketContract.transferContract()).to.equal(await transferContract.getAddress());

    // 1. Admin approvals
    await ticketContract.connect(admin).approveOrganizer(organizer.address);
    await ticketContract.connect(admin).addStaff(staff.address);

    // 2. Organiser creates event + mints to buyer A
    await ticketContract.connect(organizer).createEvent(
      "QUT Stadium Concert",
      Math.floor(Date.now() / 1000) + 30 * 86400,
      100,
      ethers.parseUnits("50", 6),
      ethers.parseUnits("75", 6),
      4
    );
    await ticketContract.connect(organizer).mintTicket(1, buyerA.address);
    expect(await ticketContract.ownerOf(1)).to.equal(buyerA.address);

    // 3. Buyer A lists for 70 USDC (under the 75 USDC cap)
    await ticketContract.connect(buyerA).approve(await transferContract.getAddress(), 1);
    await transferContract.connect(buyerA).listTicket(1, ethers.parseUnits("70", 6));

    // 4. Buyer B funds USDC and purchases
    await usdc.mint(buyerB.address, ethers.parseUnits("200", 6));
    await usdc.connect(buyerB).approve(await transferContract.getAddress(), ethers.MaxUint256);
    await transferContract.connect(buyerB).purchaseTicket(1);
    expect(await ticketContract.ownerOf(1)).to.equal(buyerB.address);
    expect(await usdc.balanceOf(buyerA.address)).to.equal(ethers.parseUnits("70", 6));

    // 5. Staff redeems with buyer B's signed challenge
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const digest = await ticketContract.redemptionDigest(1, nonce);
    const sig = await buyerB.signMessage(ethers.getBytes(digest));
    await ticketContract.connect(staff).redeemTicket(1, nonce, sig);
    expect(await ticketContract.isRedeemed(1)).to.equal(true);

    // 6. Post-redemption: ticket is locked
    // - cannot transfer
    await expect(
      ticketContract.connect(buyerB).transferFrom(buyerB.address, buyerA.address, 1)
    ).to.be.revertedWithCustomError(ticketContract, "TicketAlreadyRedeemed");

    // - cannot re-list
    await ticketContract.connect(buyerB).approve(await transferContract.getAddress(), 1);
    await expect(
      transferContract.connect(buyerB).listTicket(1, ethers.parseUnits("60", 6))
    ).to.be.revertedWithCustomError(transferContract, "TicketAlreadyRedeemed");

    // - cannot re-redeem
    const nonce2 = ethers.hexlify(ethers.randomBytes(32));
    const sig2 = await buyerB.signMessage(
      ethers.getBytes(await ticketContract.redemptionDigest(1, nonce2))
    );
    await expect(
      ticketContract.connect(staff).redeemTicket(1, nonce2, sig2)
    ).to.be.revertedWithCustomError(ticketContract, "TicketAlreadyRedeemed");
  });

  it("scalper attempt: listing 200 USDC for a 75 USDC cap is rejected on-chain", async function () {
    const [admin, organizer, , scalper] = await ethers.getSigners();
    const ticketContract = await (await ethers.getContractFactory("TicketContract")).deploy(admin.address);
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const transferContract = await (await ethers.getContractFactory("TransferContract")).deploy(
      admin.address, await ticketContract.getAddress(), await usdc.getAddress()
    );
    await ticketContract.connect(admin).approveOrganizer(organizer.address);
    await ticketContract.connect(organizer).createEvent(
      "Cap Test", 1893456000, 10,
      ethers.parseUnits("50", 6), ethers.parseUnits("75", 6), 4
    );
    await ticketContract.connect(organizer).mintTicket(1, scalper.address);
    await ticketContract.connect(scalper).approve(await transferContract.getAddress(), 1);
    await expect(
      transferContract.connect(scalper).listTicket(1, ethers.parseUnits("200", 6))
    ).to.be.revertedWithCustomError(transferContract, "ResaleCapExceeded");
  });
});
