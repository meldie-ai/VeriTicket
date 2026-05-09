const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Tests for TicketContract.
 *
 * Roles in fixtures:
 *  - admin     platform administrator (DEFAULT_ADMIN_ROLE)
 *  - organizer event organiser (ORGANIZER_ROLE)
 *  - staff     venue door staff (STAFF_ROLE)
 *  - buyer1, buyer2  attendees
 *  - other     unprivileged
 */
describe("TicketContract", function () {
  async function deployFixture() {
    const [admin, organizer, staff, buyer1, buyer2, other] = await ethers.getSigners();
    const Ticket = await ethers.getContractFactory("TicketContract");
    const ticketContract = await Ticket.deploy(admin.address);
    await ticketContract.waitForDeployment();
    return { ticketContract, admin, organizer, staff, buyer1, buyer2, other };
  }

  async function withRoles() {
    const ctx = await deployFixture();
    await ctx.ticketContract.connect(ctx.admin).approveOrganizer(ctx.organizer.address);
    await ctx.ticketContract.connect(ctx.admin).addStaff(ctx.staff.address);
    return ctx;
  }

  async function withEvent() {
    const ctx = await withRoles();
    const tx = await ctx.ticketContract.connect(ctx.organizer).createEvent(
      "QUT Stadium Concert",
      Math.floor(Date.now() / 1000) + 30 * 24 * 3600, // 30 days out
      100, // supply
      ethers.parseUnits("50", 6), // primary price 50 USDC
      ethers.parseUnits("75", 6), // resale cap 75 USDC
      4 // per-wallet limit 4
    );
    await tx.wait();
    return { ...ctx, eventId: 1n };
  }

  // ---------------------------------------------------------------------------
  describe("Deployment", function () {
    it("grants DEFAULT_ADMIN_ROLE to the admin address", async function () {
      const { ticketContract, admin } = await deployFixture();
      const role = await ticketContract.DEFAULT_ADMIN_ROLE();
      expect(await ticketContract.hasRole(role, admin.address)).to.equal(true);
    });

    it("uses the right ERC-721 name and symbol", async function () {
      const { ticketContract } = await deployFixture();
      expect(await ticketContract.name()).to.equal("VeriTicket");
      expect(await ticketContract.symbol()).to.equal("VTKT");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Role management", function () {
    it("admin can approve and revoke organisers", async function () {
      const { ticketContract, admin, organizer } = await deployFixture();
      const ORGANIZER_ROLE = await ticketContract.ORGANIZER_ROLE();
      await expect(ticketContract.connect(admin).approveOrganizer(organizer.address))
        .to.emit(ticketContract, "OrganizerApproved").withArgs(organizer.address);
      expect(await ticketContract.hasRole(ORGANIZER_ROLE, organizer.address)).to.equal(true);

      await expect(ticketContract.connect(admin).revokeOrganizer(organizer.address))
        .to.emit(ticketContract, "OrganizerRevoked").withArgs(organizer.address);
      expect(await ticketContract.hasRole(ORGANIZER_ROLE, organizer.address)).to.equal(false);
    });

    it("non-admin cannot approve an organiser", async function () {
      const { ticketContract, other, organizer } = await deployFixture();
      await expect(
        ticketContract.connect(other).approveOrganizer(organizer.address)
      ).to.be.revertedWithCustomError(ticketContract, "AccessControlUnauthorizedAccount");
    });

    it("admin can add and remove staff", async function () {
      const { ticketContract, admin, staff } = await deployFixture();
      const STAFF_ROLE = await ticketContract.STAFF_ROLE();
      await ticketContract.connect(admin).addStaff(staff.address);
      expect(await ticketContract.hasRole(STAFF_ROLE, staff.address)).to.equal(true);
      await ticketContract.connect(admin).removeStaff(staff.address);
      expect(await ticketContract.hasRole(STAFF_ROLE, staff.address)).to.equal(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe("Event creation", function () {
    it("approved organiser can create an event", async function () {
      const { ticketContract, organizer } = await withRoles();
      await expect(
        ticketContract.connect(organizer).createEvent(
          "Test Event", 1893456000, 100,
          ethers.parseUnits("50", 6), ethers.parseUnits("75", 6), 4
        )
      ).to.emit(ticketContract, "EventCreated").withArgs(1n, organizer.address, "Test Event", 100);
      const ev = await ticketContract.getEventDetails(1);
      expect(ev.organizer).to.equal(organizer.address);
      expect(ev.maxResalePrice).to.equal(ethers.parseUnits("75", 6));
    });

    it("rejects creation by non-organisers", async function () {
      const { ticketContract, other } = await withRoles();
      await expect(
        ticketContract.connect(other).createEvent(
          "X", 1893456000, 10,
          ethers.parseUnits("50", 6), ethers.parseUnits("75", 6), 4
        )
      ).to.be.revertedWithCustomError(ticketContract, "AccessControlUnauthorizedAccount");
    });

    it("rejects primary price of zero", async function () {
      const { ticketContract, organizer } = await withRoles();
      await expect(
        ticketContract.connect(organizer).createEvent(
          "X", 1893456000, 10, 0, ethers.parseUnits("75", 6), 4
        )
      ).to.be.revertedWithCustomError(ticketContract, "InvalidPrimaryPrice");
    });

    it("rejects resale cap below primary price", async function () {
      const { ticketContract, organizer } = await withRoles();
      await expect(
        ticketContract.connect(organizer).createEvent(
          "X", 1893456000, 10,
          ethers.parseUnits("50", 6), ethers.parseUnits("40", 6), 4
        )
      ).to.be.revertedWithCustomError(ticketContract, "InvalidResaleCap");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Minting", function () {
    it("organiser can mint a ticket to an attendee", async function () {
      const { ticketContract, organizer, buyer1, eventId } = await withEvent();
      await expect(ticketContract.connect(organizer).mintTicket(eventId, buyer1.address))
        .to.emit(ticketContract, "TicketMinted").withArgs(1n, eventId, buyer1.address);
      expect(await ticketContract.ownerOf(1)).to.equal(buyer1.address);
      expect(await ticketContract.walletEventCount(eventId, buyer1.address)).to.equal(1n);
    });

    it("rejects mint by a different organiser (must own event)", async function () {
      const { ticketContract, admin, organizer, other, buyer1, eventId } = await withEvent();
      // Approve `other` as organiser, but the event still belongs to `organizer`.
      await ticketContract.connect(admin).approveOrganizer(other.address);
      await expect(
        ticketContract.connect(other).mintTicket(eventId, buyer1.address)
      ).to.be.revertedWithCustomError(ticketContract, "NotEventOrganizer");
    });

    it("rejects mint above per-wallet limit", async function () {
      const { ticketContract, organizer, buyer1, eventId } = await withEvent();
      for (let i = 0; i < 4; i++) {
        await ticketContract.connect(organizer).mintTicket(eventId, buyer1.address);
      }
      await expect(
        ticketContract.connect(organizer).mintTicket(eventId, buyer1.address)
      ).to.be.revertedWithCustomError(ticketContract, "PerWalletLimitExceeded");
    });

    it("rejects mint past total supply", async function () {
      const { ticketContract, admin, organizer, buyer1 } = await withRoles();
      // Tiny event: 2 tickets, no per-wallet limit
      await ticketContract.connect(organizer).createEvent(
        "Tiny", 1893456000, 2,
        ethers.parseUnits("10", 6), ethers.parseUnits("15", 6), 0
      );
      await ticketContract.connect(organizer).mintTicket(1, buyer1.address);
      await ticketContract.connect(organizer).mintTicket(1, buyer1.address);
      await expect(
        ticketContract.connect(organizer).mintTicket(1, buyer1.address)
      ).to.be.revertedWithCustomError(ticketContract, "SoldOut");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Redemption (challenge-response)", function () {
    async function mintedFixture() {
      const ctx = await withEvent();
      await ctx.ticketContract.connect(ctx.organizer).mintTicket(ctx.eventId, ctx.buyer1.address);
      return { ...ctx, ticketId: 1n };
    }

    async function signRedemption(ticketContract, signer, ticketId, nonce) {
      const digest = await ticketContract.redemptionDigest(ticketId, nonce);
      // EIP-191 personal sign over the 32-byte digest
      return signer.signMessage(ethers.getBytes(digest));
    }

    it("staff can redeem a ticket with the owner's signature", async function () {
      const { ticketContract, staff, buyer1, ticketId } = await mintedFixture();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signRedemption(ticketContract, buyer1, ticketId, nonce);
      await expect(ticketContract.connect(staff).redeemTicket(ticketId, nonce, sig))
        .to.emit(ticketContract, "TicketRedeemed").withArgs(ticketId, staff.address, buyer1.address);
      expect(await ticketContract.isRedeemed(ticketId)).to.equal(true);
    });

    it("rejects a signature from someone other than the owner", async function () {
      const { ticketContract, staff, buyer2, ticketId } = await mintedFixture();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await signRedemption(ticketContract, buyer2, ticketId, nonce);
      await expect(
        ticketContract.connect(staff).redeemTicket(ticketId, nonce, sig)
      ).to.be.revertedWithCustomError(ticketContract, "InvalidSignature");
    });

    it("rejects replay of the same nonce", async function () {
      const { ticketContract, organizer, staff, buyer1, buyer2, eventId } = await withEvent();
      await ticketContract.connect(organizer).mintTicket(eventId, buyer1.address);
      await ticketContract.connect(organizer).mintTicket(eventId, buyer2.address);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig1 = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(1, nonce))
      );
      await ticketContract.connect(staff).redeemTicket(1, nonce, sig1);
      // Same nonce, different ticket - this is keyed by (ticketId, nonce) so it's a fresh slot,
      // but reusing exact (ticketId, nonce) is what we want to prevent. Check that path:
      await expect(
        ticketContract.connect(staff).redeemTicket(1, nonce, sig1)
      ).to.be.revertedWithCustomError(ticketContract, "TicketAlreadyRedeemed");
    });

    it("rejects redemption of an already-redeemed ticket", async function () {
      const { ticketContract, staff, buyer1, ticketId } = await mintedFixture();
      const nonce1 = ethers.hexlify(ethers.randomBytes(32));
      const sig1 = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(ticketId, nonce1))
      );
      await ticketContract.connect(staff).redeemTicket(ticketId, nonce1, sig1);

      const nonce2 = ethers.hexlify(ethers.randomBytes(32));
      const sig2 = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(ticketId, nonce2))
      );
      await expect(
        ticketContract.connect(staff).redeemTicket(ticketId, nonce2, sig2)
      ).to.be.revertedWithCustomError(ticketContract, "TicketAlreadyRedeemed");
    });

    it("non-staff cannot redeem", async function () {
      const { ticketContract, other, buyer1, ticketId } = await mintedFixture();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(ticketId, nonce))
      );
      await expect(
        ticketContract.connect(other).redeemTicket(ticketId, nonce, sig)
      ).to.be.revertedWithCustomError(ticketContract, "AccessControlUnauthorizedAccount");
    });

    it("rejects redemption of a non-existent ticket", async function () {
      const { ticketContract, staff, buyer1 } = await withEvent();
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(999, nonce))
      );
      await expect(
        ticketContract.connect(staff).redeemTicket(999, nonce, sig)
      ).to.be.revertedWithCustomError(ticketContract, "TicketDoesNotExist");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Pause", function () {
    it("admin can pause and unpause", async function () {
      const { ticketContract, admin } = await deployFixture();
      await ticketContract.connect(admin).pause();
      expect(await ticketContract.paused()).to.equal(true);
      await ticketContract.connect(admin).unpause();
      expect(await ticketContract.paused()).to.equal(false);
    });

    it("non-admin cannot pause", async function () {
      const { ticketContract, other } = await deployFixture();
      await expect(
        ticketContract.connect(other).pause()
      ).to.be.revertedWithCustomError(ticketContract, "AccessControlUnauthorizedAccount");
    });

    it("paused contract blocks event creation, minting, redemption, transfer", async function () {
      const { ticketContract, admin, organizer, staff, buyer1, buyer2, eventId } = await withEvent();
      await ticketContract.connect(organizer).mintTicket(eventId, buyer1.address);
      await ticketContract.connect(admin).pause();

      await expect(
        ticketContract.connect(organizer).createEvent("Y", 1893456000, 1,
          ethers.parseUnits("1", 6), ethers.parseUnits("2", 6), 0)
      ).to.be.revertedWithCustomError(ticketContract, "EnforcedPause");

      await expect(
        ticketContract.connect(organizer).mintTicket(eventId, buyer2.address)
      ).to.be.revertedWithCustomError(ticketContract, "EnforcedPause");

      await expect(
        ticketContract.connect(buyer1).transferFrom(buyer1.address, buyer2.address, 1)
      ).to.be.revertedWithCustomError(ticketContract, "EnforcedPause");

      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(1, nonce))
      );
      await expect(
        ticketContract.connect(staff).redeemTicket(1, nonce, sig)
      ).to.be.revertedWithCustomError(ticketContract, "EnforcedPause");
    });
  });

  // ---------------------------------------------------------------------------
  describe("Transfer rules", function () {
    it("redeemed tickets cannot be transferred", async function () {
      const { ticketContract, organizer, staff, buyer1, buyer2, eventId } = await withEvent();
      await ticketContract.connect(organizer).mintTicket(eventId, buyer1.address);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buyer1.signMessage(
        ethers.getBytes(await ticketContract.redemptionDigest(1, nonce))
      );
      await ticketContract.connect(staff).redeemTicket(1, nonce, sig);

      await expect(
        ticketContract.connect(buyer1).transferFrom(buyer1.address, buyer2.address, 1)
      ).to.be.revertedWithCustomError(ticketContract, "TicketAlreadyRedeemed");
    });

    it("per-wallet cap also applies on direct transfers", async function () {
      const { ticketContract, organizer, buyer1, buyer2, eventId } = await withEvent();
      // Buyer2 mints up to limit
      for (let i = 0; i < 4; i++) {
        await ticketContract.connect(organizer).mintTicket(eventId, buyer2.address);
      }
      // Buyer1 has one and tries to send to buyer2 - should fail (over cap)
      await ticketContract.connect(organizer).mintTicket(eventId, buyer1.address);
      const ticketId = 5n;
      await expect(
        ticketContract.connect(buyer1).transferFrom(buyer1.address, buyer2.address, ticketId)
      ).to.be.revertedWithCustomError(ticketContract, "PerWalletLimitExceeded");
    });
  });
});
