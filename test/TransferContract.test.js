const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Tests for TransferContract - VeriTicket's resale marketplace.
 */
describe("TransferContract", function () {
  async function deployFixture() {
    const [admin, organizer, staff, seller, buyer, other] = await ethers.getSigners();

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

    await ticketContract.connect(admin).setTransferContract(await transferContract.getAddress());
    await ticketContract.connect(admin).approveOrganizer(organizer.address);
    await ticketContract.connect(admin).addStaff(staff.address);

    // Create one event with cap 75 USDC, primary 50 USDC.
    await ticketContract.connect(organizer).createEvent(
      "Test Event",
      Math.floor(Date.now() / 1000) + 30 * 86400,
      100,
      ethers.parseUnits("50", 6),
      ethers.parseUnits("75", 6),
      4
    );

    // Mint ticket #1 to seller.
    await ticketContract.connect(organizer).mintTicket(1, seller.address);

    // Fund the buyer with USDC and approve the marketplace to spend it.
    await usdc.mint(buyer.address, ethers.parseUnits("1000", 6));
    await usdc.connect(buyer).approve(await transferContract.getAddress(), ethers.MaxUint256);

    return { ticketContract, transferContract, usdc, admin, organizer, staff, seller, buyer, other };
  }

  // ---------------------------------------------------------------------------
  describe("Listing", function () {
    it("seller can list their ticket below the cap after approving the marketplace", async function () {
      const { ticketContract, transferContract, seller } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      const price = ethers.parseUnits("60", 6);
      await expect(transferContract.connect(seller).listTicket(1, price))
        .to.emit(transferContract, "TicketListed").withArgs(1n, seller.address, price);

      const listing = await transferContract.getActiveListing(1);
      expect(listing.active).to.equal(true);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
    });

    it("rejects listing without an approval", async function () {
      const { transferContract, seller } = await deployFixture();
      await expect(
        transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6))
      ).to.be.revertedWithCustomError(transferContract, "NotApproved");
    });

    it("rejects listing above the resale cap", async function () {
      const { ticketContract, transferContract, seller } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await expect(
        transferContract.connect(seller).listTicket(1, ethers.parseUnits("100", 6))
      ).to.be.revertedWithCustomError(transferContract, "ResaleCapExceeded");
    });

    it("rejects price of zero", async function () {
      const { ticketContract, transferContract, seller } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await expect(
        transferContract.connect(seller).listTicket(1, 0)
      ).to.be.revertedWithCustomError(transferContract, "PriceMustBePositive");
    });

    it("rejects listing by a non-owner", async function () {
      const { ticketContract, transferContract, seller, other } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await expect(
        transferContract.connect(other).listTicket(1, ethers.parseUnits("60", 6))
      ).to.be.revertedWithCustomError(transferContract, "NotTicketOwner");
    });

    it("rejects listing of a redeemed ticket", async function () {
      const { ticketContract, transferContract, staff, seller } = await deployFixture();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const digest = await ticketContract.redemptionDigest(1, nonce);
      const sig = await seller.signMessage(ethers.getBytes(digest));
      await ticketContract.connect(staff).redeemTicket(1, nonce, sig);
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await expect(
        transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6))
      ).to.be.revertedWithCustomError(transferContract, "TicketAlreadyRedeemed");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Cancel listing", function () {
    it("seller can cancel their own listing", async function () {
      const { ticketContract, transferContract, seller } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6));
      await expect(transferContract.connect(seller).cancelListing(1))
        .to.emit(transferContract, "ListingCancelled").withArgs(1n, seller.address);
      const l = await transferContract.getActiveListing(1);
      expect(l.active).to.equal(false);
    });

    it("non-seller cannot cancel", async function () {
      const { ticketContract, transferContract, seller, other } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6));
      await expect(
        transferContract.connect(other).cancelListing(1)
      ).to.be.revertedWithCustomError(transferContract, "NotTicketOwner");
    });

    it("rejects cancel when there is no active listing", async function () {
      const { transferContract, seller } = await deployFixture();
      await expect(
        transferContract.connect(seller).cancelListing(1)
      ).to.be.revertedWithCustomError(transferContract, "NoActiveListing");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Purchase", function () {
    async function listed() {
      const ctx = await deployFixture();
      await ctx.ticketContract.connect(ctx.seller).approve(
        await ctx.transferContract.getAddress(), 1
      );
      await ctx.transferContract.connect(ctx.seller).listTicket(1, ethers.parseUnits("60", 6));
      return ctx;
    }

    it("buyer can purchase: USDC moves to seller and NFT moves to buyer atomically", async function () {
      const { ticketContract, transferContract, usdc, seller, buyer } = await listed();
      const sellerStart = await usdc.balanceOf(seller.address);
      const buyerStart = await usdc.balanceOf(buyer.address);

      await expect(transferContract.connect(buyer).purchaseTicket(1))
        .to.emit(transferContract, "TicketPurchased")
        .withArgs(1n, seller.address, buyer.address, ethers.parseUnits("60", 6));

      expect(await ticketContract.ownerOf(1)).to.equal(buyer.address);
      expect(await usdc.balanceOf(seller.address)).to.equal(sellerStart + ethers.parseUnits("60", 6));
      expect(await usdc.balanceOf(buyer.address)).to.equal(buyerStart - ethers.parseUnits("60", 6));
      const l = await transferContract.getActiveListing(1);
      expect(l.active).to.equal(false);
    });

    it("rejects purchase when there is no active listing", async function () {
      const { transferContract, buyer } = await deployFixture();
      await expect(
        transferContract.connect(buyer).purchaseTicket(1)
      ).to.be.revertedWithCustomError(transferContract, "NoActiveListing");
    });

    it("rejects buying your own listing", async function () {
      const { transferContract, usdc, seller } = await listed();
      // Give the seller USDC and an allowance, then have them try to self-buy.
      await usdc.mint(seller.address, ethers.parseUnits("100", 6));
      await usdc.connect(seller).approve(await transferContract.getAddress(), ethers.MaxUint256);
      await expect(
        transferContract.connect(seller).purchaseTicket(1)
      ).to.be.revertedWithCustomError(transferContract, "CannotBuyOwnTicket");
    });

    it("rejects purchase if seller has transferred the ticket out of band", async function () {
      const { ticketContract, transferContract, seller, buyer, other } = await listed();
      // Seller revokes approval and sends ticket directly to `other`
      await ticketContract.connect(seller).approve(ethers.ZeroAddress, 1);
      await ticketContract.connect(seller).transferFrom(seller.address, other.address, 1);
      await expect(
        transferContract.connect(buyer).purchaseTicket(1)
      ).to.be.revertedWithCustomError(transferContract, "NotTicketOwner");
    });

    it("rejects purchase if the ticket got redeemed before settlement", async function () {
      const { ticketContract, transferContract, staff, seller, buyer } = await listed();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await seller.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(1, nonce))
      );
      await ticketContract.connect(staff).redeemTicket(1, nonce, sig);
      await expect(
        transferContract.connect(buyer).purchaseTicket(1)
      ).to.be.revertedWithCustomError(transferContract, "TicketAlreadyRedeemed");
    });

    it("rejects purchase when buyer has insufficient USDC allowance", async function () {
      const { transferContract, usdc, buyer } = await listed();
      await usdc.connect(buyer).approve(await transferContract.getAddress(), 0);
      await expect(transferContract.connect(buyer).purchaseTicket(1)).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  describe("Pause", function () {
    it("admin can pause; listing and purchase are blocked", async function () {
      const { ticketContract, transferContract, admin, seller, buyer } = await deployFixture();
      await ticketContract.connect(seller).approve(await transferContract.getAddress(), 1);
      await transferContract.connect(admin).pause();

      await expect(
        transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6))
      ).to.be.revertedWithCustomError(transferContract, "EnforcedPause");

      // Cancel is allowed even when paused so that sellers can withdraw.
      // Purchase is blocked.
      await transferContract.connect(admin).unpause();
      await transferContract.connect(seller).listTicket(1, ethers.parseUnits("60", 6));
      await transferContract.connect(admin).pause();

      await expect(
        transferContract.connect(buyer).purchaseTicket(1)
      ).to.be.revertedWithCustomError(transferContract, "EnforcedPause");
    });

    it("non-admin cannot pause", async function () {
      const { transferContract, other } = await deployFixture();
      await expect(transferContract.connect(other).pause())
        .to.be.revertedWithCustomError(transferContract, "OwnableUnauthorizedAccount");
    });
  });
});
