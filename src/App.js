import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import React from 'react';
import web3 from './web3';
import TicketContract from './TicketContract';
import TransferContract from './TransferContract';
import MockUSDC from './MockUSDC';

// Helper: convert human USDC amount (e.g. "50") to 6-decimal integer string
const toUSDC = (amount) => String(Math.round(parseFloat(amount) * 1_000_000));

// Helper: convert 6-decimal integer back to readable USDC string
const fromUSDC = (raw) => (Number(raw) / 1_000_000).toFixed(2);

// Helper: shorten a hex address
const short = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

class App extends React.Component {
  state = {
    page: 'customer',
    account: '',

    // ── Customer ──────────────────────────────
    usdcAmount: '',
    usdcBalance: null,

    buyEventId: '',
    eventInfo: null,

    resellTicketId: '',
    resellPrice: '',
    listingInfo: null,

    marketTicketId: '',
    marketListing: null,

    // ── Organizer ─────────────────────────────
    eventName: '',
    eventDate: '',
    ticketSupply: '',
    perWalletLimit: '',
    primaryPrice: '',
    maxResalePrice: '',

    mintEventId: '',
    mintRecipient: '',

    // ── Admin ─────────────────────────────────
    addOrgAddr: '',
    removeOrgAddr: '',
    addStaffAddr: '',
    removeStaffAddr: '',
    tcPaused: false,
    trPaused: false,

    // ── Shared ────────────────────────────────
    // feedback[section] = { type: 'success'|'error'|'info', msg: '...' }
    feedback: {},
    // loading[section] = true while tx is pending
    loading: {},
  };

  // ── Lifecycle ────────────────────────────────────────────────────────────

  componentDidMount() {
    this.handleHashChange();
    window.addEventListener('hashchange', this.handleHashChange);
    if (window.ethereum?.selectedAddress) {
      this.setState({ account: window.ethereum.selectedAddress });
    }
    this.fetchPauseStatus();
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  handleHashChange = () => {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    const page = ['customer', 'admin', 'organizer'].includes(hash) ? hash : 'customer';
    this.setState({ page });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  setFeedback = (section, type, msg) =>
    this.setState((s) => ({ feedback: { ...s.feedback, [section]: { type, msg } } }));

  clearFeedback = (section) =>
    this.setState((s) => {
      const f = { ...s.feedback };
      delete f[section];
      return { feedback: f };
    });

  setLoading = (section, val) =>
    this.setState((s) => ({ loading: { ...s.loading, [section]: val } }));

  requireAccount = () => {
    if (!this.state.account) {
      alert('Please connect your wallet first.');
      return false;
    }
    return true;
  };

  // ── Wallet ───────────────────────────────────────────────────────────────

  connectMetaMask = async () => {
    if (!window.ethereum) {
      alert('MetaMask not detected. Please install it to continue.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        this.setState({ account: accounts[0] });
        web3.setProvider(window.ethereum);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ── Pause status ─────────────────────────────────────────────────────────

  fetchPauseStatus = async () => {
    try {
      const [tcPaused, trPaused] = await Promise.all([
        TicketContract.methods.paused().call(),
        TransferContract.methods.paused().call(),
      ]);
      this.setState({ tcPaused, trPaused });
    } catch (_) {}
  };

  // ════════════════════════════════════════════════════════════════════════
  // CUSTOMER ACTIONS
  // ════════════════════════════════════════════════════════════════════════

  // Mint MockUSDC to own wallet
  onMintUSDC = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, usdcAmount } = this.state;
    if (!usdcAmount || parseFloat(usdcAmount) <= 0) {
      return this.setFeedback('usdc', 'error', 'Enter a valid amount.');
    }
    this.setLoading('usdc', true);
    this.setFeedback('usdc', 'info', 'Waiting for MetaMask confirmation…');
    try {
      await MockUSDC.methods.mint(account, toUSDC(usdcAmount)).send({ from: account });
      this.setFeedback('usdc', 'success', `✅ Minted ${usdcAmount} USDC to your wallet.`);
    } catch (err) {
      this.setFeedback('usdc', 'error', `❌ ${err.message}`);
    }
    this.setLoading('usdc', false);
  };

  // Check USDC balance
  onCheckBalance = async () => {
    if (!this.requireAccount()) return;
    try {
      const raw = await MockUSDC.methods.balanceOf(this.state.account).call();
      const bal = fromUSDC(raw);
      this.setState({ usdcBalance: bal });
      this.setFeedback('usdc', 'success', `💰 Your balance: ${bal} USDC`);
    } catch (err) {
      this.setFeedback('usdc', 'error', `❌ ${err.message}`);
    }
  };

  // Look up event details
  onViewEvent = async (e) => {
    e.preventDefault();
    const { buyEventId } = this.state;
    if (!buyEventId) return this.setFeedback('buyTicket', 'error', 'Enter an event ID.');
    try {
      const ev = await TicketContract.methods.getEventDetails(buyEventId).call();
      this.setState({ eventInfo: ev });
      this.clearFeedback('buyTicket');
    } catch (err) {
      this.setState({ eventInfo: null });
      this.setFeedback('buyTicket', 'error', `❌ Event not found.`);
    }
  };

  // List ticket for resale (approve NFT → listTicket)
  onListTicket = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, resellTicketId, resellPrice } = this.state;
    if (!resellTicketId || !resellPrice) {
      return this.setFeedback('resell', 'error', 'Fill in both fields.');
    }
    this.setLoading('resell', true);
    this.setFeedback('resell', 'info', 'Step 1/2: Approving NFT transfer… (MetaMask will pop up)');
    try {
      const tcAddr = TransferContract.options.address;
      await TicketContract.methods.approve(tcAddr, resellTicketId).send({ from: account });
      this.setFeedback('resell', 'info', 'Step 2/2: Listing ticket… (MetaMask will pop up)');
      await TransferContract.methods.listTicket(resellTicketId, toUSDC(resellPrice)).send({ from: account });
      this.setFeedback('resell', 'success', `✅ Ticket #${resellTicketId} listed for ${resellPrice} USDC.`);
    } catch (err) {
      this.setFeedback('resell', 'error', `❌ ${err.message}`);
    }
    this.setLoading('resell', false);
  };

  // Cancel listing
  onCancelListing = async () => {
    if (!this.requireAccount()) return;
    const { account, resellTicketId } = this.state;
    if (!resellTicketId) return this.setFeedback('resell', 'error', 'Enter the Ticket ID to cancel.');
    this.setLoading('resell', true);
    this.setFeedback('resell', 'info', 'Cancelling listing…');
    try {
      await TransferContract.methods.cancelListing(resellTicketId).send({ from: account });
      this.setFeedback('resell', 'success', `✅ Listing for ticket #${resellTicketId} cancelled.`);
    } catch (err) {
      this.setFeedback('resell', 'error', `❌ ${err.message}`);
    }
    this.setLoading('resell', false);
  };

  // Check active marketplace listing
  onCheckListing = async (e) => {
    e.preventDefault();
    const { marketTicketId } = this.state;
    if (!marketTicketId) return this.setFeedback('market', 'error', 'Enter a ticket ID.');
    try {
      const listing = await TransferContract.methods.getActiveListing(marketTicketId).call();
      this.setState({ marketListing: listing });
      if (!listing.active) {
        this.setFeedback('market', 'error', 'No active listing for this ticket.');
      } else {
        this.setFeedback('market', 'info',
          `🏷 Listed by ${short(listing.seller)} for ${fromUSDC(listing.price)} USDC`);
      }
    } catch (err) {
      this.setState({ marketListing: null });
      this.setFeedback('market', 'error', `❌ ${err.message}`);
    }
  };

  // Purchase from marketplace (approve USDC → purchaseTicket)
  onPurchaseTicket = async () => {
    if (!this.requireAccount()) return;
    const { account, marketTicketId, marketListing } = this.state;
    if (!marketListing?.active) {
      return this.setFeedback('market', 'error', 'Check the listing first.');
    }
    this.setLoading('market', true);
    this.setFeedback('market', 'info', 'Step 1/2: Approving USDC… (MetaMask will pop up)');
    try {
      const tcAddr = TransferContract.options.address;
      await MockUSDC.methods.approve(tcAddr, marketListing.price).send({ from: account });
      this.setFeedback('market', 'info', 'Step 2/2: Purchasing ticket… (MetaMask will pop up)');
      await TransferContract.methods.purchaseTicket(marketTicketId).send({ from: account });
      this.setState({ marketListing: null });
      this.setFeedback('market', 'success',
        `✅ Ticket #${marketTicketId} purchased for ${fromUSDC(marketListing.price)} USDC!`);
    } catch (err) {
      this.setFeedback('market', 'error', `❌ ${err.message}`);
    }
    this.setLoading('market', false);
  };

  // ════════════════════════════════════════════════════════════════════════
  // ORGANIZER ACTIONS
  // ════════════════════════════════════════════════════════════════════════

  onCreateEvent = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, eventName, eventDate, ticketSupply, perWalletLimit, primaryPrice, maxResalePrice } = this.state;
    if (!eventName || !eventDate || !ticketSupply || !primaryPrice || !maxResalePrice) {
      return this.setFeedback('createEvent', 'error', 'Please fill in all required fields.');
    }
    const unixDate = Math.floor(new Date(eventDate).getTime() / 1000);
    this.setLoading('createEvent', true);
    this.setFeedback('createEvent', 'info', 'Creating event… (MetaMask will pop up)');
    try {
      const receipt = await TicketContract.methods.createEvent(
        eventName,
        unixDate,
        parseInt(ticketSupply),
        toUSDC(primaryPrice),
        toUSDC(maxResalePrice),
        parseInt(perWalletLimit) || 0
      ).send({ from: account });

      // Extract event ID from the EventCreated log
      const log = receipt.events?.EventCreated;
      const eventId = log?.returnValues?.eventId;
      this.setFeedback('createEvent', 'success',
        `✅ Event created! Event ID: ${eventId ?? '—'}. Share this ID with buyers.`);
      this.setState({ eventName: '', eventDate: '', ticketSupply: '', perWalletLimit: '', primaryPrice: '', maxResalePrice: '' });
    } catch (err) {
      this.setFeedback('createEvent', 'error', `❌ ${err.message}`);
    }
    this.setLoading('createEvent', false);
  };

  onMintTicket = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, mintEventId, mintRecipient } = this.state;
    if (!mintEventId || !mintRecipient) {
      return this.setFeedback('mint', 'error', 'Fill in both fields.');
    }
    this.setLoading('mint', true);
    this.setFeedback('mint', 'info', 'Minting ticket… (MetaMask will pop up)');
    try {
      const receipt = await TicketContract.methods
        .mintTicket(mintEventId, mintRecipient)
        .send({ from: account });
      const log = receipt.events?.TicketMinted;
      const ticketId = log?.returnValues?.ticketId;
      this.setFeedback('mint', 'success',
        `✅ Ticket minted! Ticket ID: ${ticketId ?? '—'} → ${short(mintRecipient)}`);
      this.setState({ mintEventId: '', mintRecipient: '' });
    } catch (err) {
      this.setFeedback('mint', 'error', `❌ ${err.message}`);
    }
    this.setLoading('mint', false);
  };

  // ════════════════════════════════════════════════════════════════════════
  // ADMIN ACTIONS
  // ════════════════════════════════════════════════════════════════════════

  onPauseTC = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('tcPause', 'info', 'Pausing… (MetaMask will pop up)');
    try {
      await TicketContract.methods.pause().send({ from: this.state.account });
      this.setState({ tcPaused: true });
      this.setFeedback('tcPause', 'success', '✅ TicketContract paused.');
    } catch (err) {
      this.setFeedback('tcPause', 'error', `❌ ${err.message}`);
    }
  };

  onUnpauseTC = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('tcPause', 'info', 'Unpausing… (MetaMask will pop up)');
    try {
      await TicketContract.methods.unpause().send({ from: this.state.account });
      this.setState({ tcPaused: false });
      this.setFeedback('tcPause', 'success', '✅ TicketContract unpaused.');
    } catch (err) {
      this.setFeedback('tcPause', 'error', `❌ ${err.message}`);
    }
  };

  onPauseTR = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('trPause', 'info', 'Pausing… (MetaMask will pop up)');
    try {
      await TransferContract.methods.pause().send({ from: this.state.account });
      this.setState({ trPaused: true });
      this.setFeedback('trPause', 'success', '✅ TransferContract paused.');
    } catch (err) {
      this.setFeedback('trPause', 'error', `❌ ${err.message}`);
    }
  };

  onUnpauseTR = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('trPause', 'info', 'Unpausing… (MetaMask will pop up)');
    try {
      await TransferContract.methods.unpause().send({ from: this.state.account });
      this.setState({ trPaused: false });
      this.setFeedback('trPause', 'success', '✅ TransferContract unpaused.');
    } catch (err) {
      this.setFeedback('trPause', 'error', `❌ ${err.message}`);
    }
  };

  onAddOrganizer = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, addOrgAddr } = this.state;
    if (!addOrgAddr) return this.setFeedback('addOrg', 'error', 'Enter a wallet address.');
    this.setFeedback('addOrg', 'info', 'Granting role… (MetaMask will pop up)');
    try {
      await TicketContract.methods.approveOrganizer(addOrgAddr).send({ from: account });
      this.setFeedback('addOrg', 'success', `✅ Organizer role granted to ${short(addOrgAddr)}`);
      this.setState({ addOrgAddr: '' });
    } catch (err) {
      this.setFeedback('addOrg', 'error', `❌ ${err.message}`);
    }
  };

  onRemoveOrganizer = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, removeOrgAddr } = this.state;
    if (!removeOrgAddr) return this.setFeedback('removeOrg', 'error', 'Enter a wallet address.');
    this.setFeedback('removeOrg', 'info', 'Revoking role… (MetaMask will pop up)');
    try {
      await TicketContract.methods.revokeOrganizer(removeOrgAddr).send({ from: account });
      this.setFeedback('removeOrg', 'success', `✅ Organizer role revoked from ${short(removeOrgAddr)}`);
      this.setState({ removeOrgAddr: '' });
    } catch (err) {
      this.setFeedback('removeOrg', 'error', `❌ ${err.message}`);
    }
  };

  onAddStaff = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, addStaffAddr } = this.state;
    if (!addStaffAddr) return this.setFeedback('addStaff', 'error', 'Enter a wallet address.');
    this.setFeedback('addStaff', 'info', 'Granting role… (MetaMask will pop up)');
    try {
      await TicketContract.methods.addStaff(addStaffAddr).send({ from: account });
      this.setFeedback('addStaff', 'success', `✅ Staff role granted to ${short(addStaffAddr)}`);
      this.setState({ addStaffAddr: '' });
    } catch (err) {
      this.setFeedback('addStaff', 'error', `❌ ${err.message}`);
    }
  };

  onRemoveStaff = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, removeStaffAddr } = this.state;
    if (!removeStaffAddr) return this.setFeedback('removeStaff', 'error', 'Enter a wallet address.');
    this.setFeedback('removeStaff', 'info', 'Revoking role… (MetaMask will pop up)');
    try {
      await TicketContract.methods.removeStaff(removeStaffAddr).send({ from: account });
      this.setFeedback('removeStaff', 'success', `✅ Staff role revoked from ${short(removeStaffAddr)}`);
      this.setState({ removeStaffAddr: '' });
    } catch (err) {
      this.setFeedback('removeStaff', 'error', `❌ ${err.message}`);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ════════════════════════════════════════════════════════════════════════

  renderFeedback(section) {
    const fb = this.state.feedback[section];
    if (!fb) return null;
    return <div className={`vt-feedback ${fb.type}`}>{fb.msg}</div>;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGES
  // ════════════════════════════════════════════════════════════════════════

  renderAdmin() {
    const { tcPaused, trPaused, addOrgAddr, removeOrgAddr, addStaffAddr, removeStaffAddr, loading } = this.state;

    return (
      <div className="page-wrapper">
        <div className="page-header">
          <span className="role-badge admin">Admin</span>
          <h1>Platform Administration</h1>
          <p>Manage roles and control contract operations.</p>
        </div>

        <div className="row g-4">

          {/* Pause TicketContract */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-red">🎫</span>Ticket Contract</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Freeze all minting, transfers, and redemptions.
                </p>
                <div className="btn-group-equal">
                  <button className="btn-vt-danger" onClick={this.onPauseTC} disabled={tcPaused}>⏸ Pause</button>
                  <button className="btn-vt-success" onClick={this.onUnpauseTC} disabled={!tcPaused}>▶ Unpause</button>
                </div>
                <div className={`pause-status ${tcPaused ? 'paused' : 'active'}`}>
                  {tcPaused ? '⏸ Paused' : '● Active — Contract is running'}
                </div>
                {this.renderFeedback('tcPause')}
              </div>
            </div>
          </div>

          {/* Pause TransferContract */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-blue">🔄</span>Transfer Contract</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Freeze all ticket listings and purchases.
                </p>
                <div className="btn-group-equal">
                  <button className="btn-vt-danger" onClick={this.onPauseTR} disabled={trPaused}>⏸ Pause</button>
                  <button className="btn-vt-success" onClick={this.onUnpauseTR} disabled={!trPaused}>▶ Unpause</button>
                </div>
                <div className={`pause-status ${trPaused ? 'paused' : 'active'}`}>
                  {trPaused ? '⏸ Paused' : '● Active — Contract is running'}
                </div>
                {this.renderFeedback('trPause')}
              </div>
            </div>
          </div>

          {/* Add Organizer */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-green">➕</span>Add Organizer</h5>
                <form onSubmit={this.onAddOrganizer}>
                  <div className="mb-3">
                    <label className="form-label">Wallet Address</label>
                    <input type="text" className="form-control" placeholder="0x..."
                      value={addOrgAddr} onChange={(e) => this.setState({ addOrgAddr: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-primary">Grant Organizer Role</button>
                </form>
                {this.renderFeedback('addOrg')}
              </div>
            </div>
          </div>

          {/* Remove Organizer */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-red">➖</span>Remove Organizer</h5>
                <form onSubmit={this.onRemoveOrganizer}>
                  <div className="mb-3">
                    <label className="form-label">Wallet Address</label>
                    <input type="text" className="form-control" placeholder="0x..."
                      value={removeOrgAddr} onChange={(e) => this.setState({ removeOrgAddr: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-danger">Revoke Organizer Role</button>
                </form>
                {this.renderFeedback('removeOrg')}
              </div>
            </div>
          </div>

          {/* Add Staff */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-purple">➕</span>Add Staff</h5>
                <form onSubmit={this.onAddStaff}>
                  <div className="mb-3">
                    <label className="form-label">Wallet Address</label>
                    <input type="text" className="form-control" placeholder="0x..."
                      value={addStaffAddr} onChange={(e) => this.setState({ addStaffAddr: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-primary">Grant Staff Role</button>
                </form>
                {this.renderFeedback('addStaff')}
              </div>
            </div>
          </div>

          {/* Remove Staff */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-orange">➖</span>Remove Staff</h5>
                <form onSubmit={this.onRemoveStaff}>
                  <div className="mb-3">
                    <label className="form-label">Wallet Address</label>
                    <input type="text" className="form-control" placeholder="0x..."
                      value={removeStaffAddr} onChange={(e) => this.setState({ removeStaffAddr: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-danger">Revoke Staff Role</button>
                </form>
                {this.renderFeedback('removeStaff')}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  renderOrganizer() {
    const {
      eventName, eventDate, ticketSupply, perWalletLimit, primaryPrice, maxResalePrice,
      mintEventId, mintRecipient, loading,
    } = this.state;

    return (
      <div className="page-wrapper">
        <div className="page-header">
          <span className="role-badge organizer">Organizer</span>
          <h1>Event Management</h1>
          <p>Create events and issue tickets to attendees.</p>
        </div>

        <div className="row g-4">

          {/* Create Event */}
          <div className="col-12 col-lg-6">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-blue">📅</span>Create Event</h5>
                <form onSubmit={this.onCreateEvent}>
                  <div className="mb-3">
                    <label className="form-label">Event Name</label>
                    <input type="text" className="form-control" placeholder="e.g. QUT Stadium Concert"
                      value={eventName} onChange={(e) => this.setState({ eventName: e.target.value })} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Event Date</label>
                    <input type="date" className="form-control"
                      value={eventDate} onChange={(e) => this.setState({ eventDate: e.target.value })} />
                  </div>
                  <div className="row g-3 mb-3">
                    <div className="col-6">
                      <label className="form-label">Ticket Supply</label>
                      <input type="number" className="form-control" placeholder="e.g. 500" min="1"
                        value={ticketSupply} onChange={(e) => this.setState({ ticketSupply: e.target.value })} />
                    </div>
                    <div className="col-6">
                      <label className="form-label">Per Wallet Limit</label>
                      <input type="number" className="form-control" placeholder="0 = unlimited" min="0"
                        value={perWalletLimit} onChange={(e) => this.setState({ perWalletLimit: e.target.value })} />
                    </div>
                  </div>
                  <div className="row g-3 mb-4">
                    <div className="col-6">
                      <label className="form-label">Primary Price (USDC)</label>
                      <input type="number" className="form-control" placeholder="e.g. 50" min="0" step="0.01"
                        value={primaryPrice} onChange={(e) => this.setState({ primaryPrice: e.target.value })} />
                    </div>
                    <div className="col-6">
                      <label className="form-label">Max Resale Price (USDC)</label>
                      <input type="number" className="form-control" placeholder="e.g. 75" min="0" step="0.01"
                        value={maxResalePrice} onChange={(e) => this.setState({ maxResalePrice: e.target.value })} />
                    </div>
                  </div>
                  <button type="submit" className="btn-vt-primary" disabled={loading.createEvent}>
                    {loading.createEvent ? 'Creating…' : 'Create Event'}
                  </button>
                </form>
                {this.renderFeedback('createEvent')}
              </div>
            </div>
          </div>

          {/* Mint Ticket */}
          <div className="col-12 col-lg-6">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-green">🎟</span>Mint Ticket</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1.2rem' }}>
                  Issue a ticket NFT for a specific event directly to an attendee's wallet. Payment is collected
                  off-chain before calling this.
                </p>
                <form onSubmit={this.onMintTicket}>
                  <div className="mb-3">
                    <label className="form-label">Event ID</label>
                    <input type="number" className="form-control" placeholder="e.g. 1" min="1"
                      value={mintEventId} onChange={(e) => this.setState({ mintEventId: e.target.value })} />
                  </div>
                  <div className="mb-4">
                    <label className="form-label">Recipient Address</label>
                    <input type="text" className="form-control" placeholder="0x..."
                      value={mintRecipient} onChange={(e) => this.setState({ mintRecipient: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-primary" disabled={loading.mint}>
                    {loading.mint ? 'Minting…' : 'Mint Ticket'}
                  </button>
                </form>
                {this.renderFeedback('mint')}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  renderCustomer() {
    const {
      usdcAmount, usdcBalance,
      buyEventId, eventInfo,
      resellTicketId, resellPrice,
      marketTicketId, marketListing,
      loading,
    } = this.state;

    return (
      <div className="page-wrapper">
        <div className="page-header">
          <span className="role-badge customer">Customer</span>
          <h1>My Tickets</h1>
          <p>Buy, sell, and manage your event tickets.</p>
        </div>

        <div className="row g-4">

          {/* Get Test USDC */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-green">💵</span>Get Test USDC</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Mint MockUSDC tokens to your wallet for testing purchases on Amoy.
                </p>
                <form onSubmit={this.onMintUSDC}>
                  <div className="mb-3">
                    <label className="form-label">Amount (USDC)</label>
                    <input type="number" className="form-control" placeholder="e.g. 500" min="1"
                      value={usdcAmount} onChange={(e) => this.setState({ usdcAmount: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-primary" disabled={loading.usdc}
                    style={{ marginBottom: '0.6rem' }}>
                    {loading.usdc ? 'Minting…' : 'Mint USDC'}
                  </button>
                </form>
                <button className="btn-vt-secondary" onClick={this.onCheckBalance}>
                  {usdcBalance !== null ? `Balance: ${usdcBalance} USDC` : 'Check My Balance'}
                </button>
                {this.renderFeedback('usdc')}
              </div>
            </div>
          </div>

          {/* View Event Details */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-blue">🎫</span>View Event</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Look up event details. Contact the organizer to purchase a primary-sale ticket.
                </p>
                <form onSubmit={this.onViewEvent}>
                  <div className="mb-3">
                    <label className="form-label">Event ID</label>
                    <input type="number" className="form-control" placeholder="e.g. 1" min="1"
                      value={buyEventId} onChange={(e) => this.setState({ buyEventId: e.target.value, eventInfo: null })} />
                  </div>
                  <button type="submit" className="btn-vt-primary">View Event Details</button>
                </form>
                {eventInfo && (
                  <div className="vt-feedback info" style={{ marginTop: '0.8rem' }}>
                    <strong>{eventInfo.name}</strong><br />
                    Supply: {eventInfo.ticketsMinted}/{eventInfo.ticketSupply} sold<br />
                    Primary price: {fromUSDC(eventInfo.primaryPrice)} USDC<br />
                    Resale cap: {fromUSDC(eventInfo.maxResalePrice)} USDC
                  </div>
                )}
                {this.renderFeedback('buyTicket')}
              </div>
            </div>
          </div>

          {/* Resell Ticket */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-orange">🔁</span>Resell Ticket</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  List your ticket. MetaMask will prompt twice — once to approve the NFT, once to list it.
                </p>
                <form onSubmit={this.onListTicket}>
                  <div className="mb-3">
                    <label className="form-label">Ticket ID</label>
                    <input type="number" className="form-control" placeholder="e.g. 5" min="1"
                      value={resellTicketId} onChange={(e) => this.setState({ resellTicketId: e.target.value })} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Asking Price (USDC)</label>
                    <input type="number" className="form-control" placeholder="e.g. 65" min="1"
                      value={resellPrice} onChange={(e) => this.setState({ resellPrice: e.target.value })} />
                  </div>
                  <button type="submit" className="btn-vt-primary" disabled={loading.resell}
                    style={{ marginBottom: '0.6rem' }}>
                    {loading.resell ? 'Processing…' : 'List for Sale'}
                  </button>
                </form>
                <button className="btn-vt-danger" onClick={this.onCancelListing} disabled={loading.resell}>
                  Cancel Listing
                </button>
                {this.renderFeedback('resell')}
              </div>
            </div>
          </div>

          {/* Buy from Marketplace */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-purple">🛒</span>Buy from Marketplace</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Check a listing then purchase. MetaMask will prompt twice — USDC approval then payment.
                </p>
                <form onSubmit={this.onCheckListing}>
                  <div className="mb-3">
                    <label className="form-label">Ticket ID</label>
                    <input type="number" className="form-control" placeholder="e.g. 5" min="1"
                      value={marketTicketId} onChange={(e) => this.setState({ marketTicketId: e.target.value, marketListing: null })} />
                  </div>
                  <button type="submit" className="btn-vt-primary" style={{ marginBottom: '0.6rem' }}>
                    Check Listing
                  </button>
                </form>
                <button className="btn-vt-success" onClick={this.onPurchaseTicket}
                  disabled={!marketListing?.active || loading.market}>
                  {loading.market ? 'Processing…' : 'Purchase Ticket'}
                </button>
                {this.renderFeedback('market')}
              </div>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // ROOT RENDER
  // ════════════════════════════════════════════════════════════════════════

  render() {
    const { page, account } = this.state;

    return (
      <div>
        <nav className="navbar navbar-expand-lg vt-navbar">
          <div className="container-fluid">
            <span className="navbar-brand">Veri<span>Ticket</span></span>
            <button className="navbar-toggler" type="button"
              data-bs-toggle="collapse" data-bs-target="#navMenu"
              style={{ borderColor: 'rgba(255,255,255,0.3)' }}>
              <span className="navbar-toggler-icon" />
            </button>
            <div className="collapse navbar-collapse" id="navMenu">
              <ul className="navbar-nav me-auto mb-2 mb-lg-0">
                <li className="nav-item">
                  <a className={`nav-link ${page === 'customer' ? 'active' : ''}`} href="#customer">Customer</a>
                </li>
                <li className="nav-item">
                  <a className={`nav-link ${page === 'organizer' ? 'active' : ''}`} href="#organizer">Organizer</a>
                </li>
                <li className="nav-item">
                  <a className={`nav-link ${page === 'admin' ? 'active' : ''}`} href="#admin">Admin</a>
                </li>
              </ul>
              <div className="d-flex align-items-center">
                {account ? (
                  <span className="wallet-badge">🟢 {short(account)}</span>
                ) : (
                  <button className="btn connect-btn" onClick={this.connectMetaMask}>
                    Connect Wallet
                  </button>
                )}
              </div>
            </div>
          </div>
        </nav>

        {page === 'admin'     && this.renderAdmin()}
        {page === 'organizer' && this.renderOrganizer()}
        {page === 'customer'  && this.renderCustomer()}
      </div>
    );
  }
}

export default App;
