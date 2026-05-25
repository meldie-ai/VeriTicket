import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import React from 'react';
import web3 from './web3';
import TicketContract from './TicketContract';
import TransferContract from './TransferContract';
import MockUSDC from './MockUSDC';

// ── Formatting helpers ────────────────────────────────────────────────────────
const toUSDC   = (n)  => String(Math.round(parseFloat(n) * 1_000_000));
const fromUSDC = (n)  => (Number(n) / 1_000_000).toFixed(2);
const short    = (a)  => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '';
const fmtDate  = (ts) => {
  if (!ts || ts === '0') return '—';
  return new Date(Number(ts) * 1000).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
};

const AMOY_CHAIN_ID = '0x13882'; // 80002 in hex

class App extends React.Component {
  state = {
    page: 'customer',
    account: '',

    // Roles
    roles: { isAdmin: false, isOrganizer: false },
    rolesLoading: false,

    // Browsers
    allEvents: [],
    eventsLoading: false,
    myTickets: [],
    ticketsLoading: false,

    // ── Customer form state ───────────────────────────
    usdcAmount: '',
    usdcBalance: null,
    buyEventId: '',
    eventInfo: null,
    resellTicketId: '',
    resellPrice: '',
    marketTicketId: '',
    marketListing: null,

    // ── Organizer form state ──────────────────────────
    eventName: '', eventDate: '', ticketSupply: '',
    perWalletLimit: '', primaryPrice: '', maxResalePrice: '',
    mintEventId: '', mintRecipient: '',

    // ── Admin form state ──────────────────────────────
    addOrgAddr: '', removeOrgAddr: '',
    addStaffAddr: '', removeStaffAddr: '',
    tcPaused: false, trPaused: false,

    // ── Shared ────────────────────────────────────────
    feedback: {},
    loading: {},
    wrongNetwork: false,
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  componentDidMount() {
    this.handleHashChange();
    window.addEventListener('hashchange', this.handleHashChange);
    if (window.ethereum?.selectedAddress) {
      const account = window.ethereum.selectedAddress;
      this.setState({ account }, () => {
        this.checkNetwork().then(() => {
          this.checkRoles(account);
          this.fetchMyTickets(account);
        });
      });
    }
    // Listen for network and account changes in MetaMask
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => window.location.reload());
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          const account = accounts[0];
          this.setState({ account, roles: { isAdmin: false, isOrganizer: false } }, () => {
            this.checkRoles(account);
            this.fetchMyTickets(account);
          });
        } else {
          this.setState({ account: '', roles: { isAdmin: false, isOrganizer: false } });
        }
      });
    }
    this.fetchAllEvents();
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  setFeedback = (section, type, msg) =>
    this.setState((s) => ({ feedback: { ...s.feedback, [section]: { type, msg } } }));

  setLoading = (section, val) =>
    this.setState((s) => ({ loading: { ...s.loading, [section]: val } }));

  requireAccount = () => {
    if (!this.state.account) { alert('Please connect your wallet first.'); return false; }
    return true;
  };

  // ── Wallet & roles ────────────────────────────────────────────────────────

  connectMetaMask = async () => {
    if (!window.ethereum) { alert('MetaMask not detected.'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        const account = accounts[0];
        web3.setProvider(window.ethereum);
        this.setState({ account }, async () => {
          const onCorrectNetwork = await this.checkNetwork();
          if (onCorrectNetwork) {
            this.checkRoles(account);
            this.fetchMyTickets(account);
          }
        });
      }
    } catch (err) { console.error(err); }
  };

  // Returns true if on Amoy, false + prompts switch otherwise
  checkNetwork = async () => {
    if (!window.ethereum) return true; // no MetaMask, using RPC fallback
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== AMOY_CHAIN_ID) {
        this.setState({ wrongNetwork: true });
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: AMOY_CHAIN_ID }],
          });
          this.setState({ wrongNetwork: false });
          return true;
        } catch (switchErr) {
          // Network not added to MetaMask yet — add it automatically
          if (switchErr.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: AMOY_CHAIN_ID,
                chainName: 'Polygon Amoy',
                nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
                rpcUrls: ['https://rpc-amoy.polygon.technology'],
                blockExplorerUrls: ['https://amoy.polygonscan.com'],
              }],
            });
            this.setState({ wrongNetwork: false });
            return true;
          }
          return false;
        }
      }
      this.setState({ wrongNetwork: false });
      return true;
    } catch (err) {
      console.error('Network check failed:', err);
      return false;
    }
  };

  checkRoles = async (account) => {
    this.setState({ rolesLoading: true });
    try {
      const [adminRole, orgRole] = await Promise.all([
        TicketContract.methods.DEFAULT_ADMIN_ROLE().call(),
        TicketContract.methods.ORGANIZER_ROLE().call(),
      ]);
      const [isAdmin, isOrganizer] = await Promise.all([
        TicketContract.methods.hasRole(adminRole, account).call(),
        TicketContract.methods.hasRole(orgRole, account).call(),
      ]);
      this.setState({ roles: { isAdmin, isOrganizer } });
    } catch (err) {
      console.error('Role check failed:', err);
    }
    this.setState({ rolesLoading: false });
  };

  fetchPauseStatus = async () => {
    try {
      const [tcPaused, trPaused] = await Promise.all([
        TicketContract.methods.paused().call(),
        TransferContract.methods.paused().call(),
      ]);
      this.setState({ tcPaused, trPaused });
    } catch (_) {}
  };

  // ── Data fetching ─────────────────────────────────────────────────────────

  fetchAllEvents = async () => {
    this.setState({ eventsLoading: true });
    try {
      const logs = await TicketContract.getPastEvents('EventCreated', {
        fromBlock: 0, toBlock: 'latest',
      });
      const events = await Promise.all(
        logs.map(async (log) => {
          const eventId = log.returnValues.eventId;
          const details = await TicketContract.methods.getEventDetails(eventId).call();
          return { eventId, ...details };
        })
      );
      this.setState({ allEvents: events });
    } catch (err) { console.error('Fetch events failed:', err); }
    this.setState({ eventsLoading: false });
  };

  fetchMyTickets = async (account) => {
    const addr = account || this.state.account;
    if (!addr) return;
    this.setState({ ticketsLoading: true });
    try {
      const logs = await TicketContract.getPastEvents('TicketMinted', {
        fromBlock: 0, toBlock: 'latest',
      });
      const details = await Promise.all(
        logs.map((log) =>
          TicketContract.methods.getTicketDetails(log.returnValues.ticketId).call()
            .then((d) => ({ ticketId: log.returnValues.ticketId, ...d }))
            .catch(() => null)
        )
      );
      const mine = details.filter(
        (d) => d && d.ticketOwner?.toLowerCase() === addr.toLowerCase()
      );
      this.setState({ myTickets: mine });
    } catch (err) { console.error('Fetch tickets failed:', err); }
    this.setState({ ticketsLoading: false });
  };

  // ════════════════════════════════════════════════════════════════════════════
  // CUSTOMER ACTIONS
  // ════════════════════════════════════════════════════════════════════════════

  onMintUSDC = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, usdcAmount } = this.state;
    if (!usdcAmount || parseFloat(usdcAmount) <= 0)
      return this.setFeedback('usdc', 'error', 'Enter a valid amount.');
    this.setLoading('usdc', true);
    this.setFeedback('usdc', 'info', 'Waiting for MetaMask…');
    try {
      await MockUSDC.methods.mint(account, toUSDC(usdcAmount)).send({ from: account });
      this.setFeedback('usdc', 'success', `✅ Minted ${usdcAmount} USDC to your wallet.`);
    } catch (err) { this.setFeedback('usdc', 'error', `❌ ${err.message}`); }
    this.setLoading('usdc', false);
  };

  onCheckBalance = async () => {
    if (!this.requireAccount()) return;
    try {
      const raw = await MockUSDC.methods.balanceOf(this.state.account).call();
      this.setState({ usdcBalance: fromUSDC(raw) });
      this.setFeedback('usdc', 'success', `💰 Balance: ${fromUSDC(raw)} USDC`);
    } catch (err) { this.setFeedback('usdc', 'error', `❌ ${err.message}`); }
  };

  onViewEvent = async (e) => {
    e.preventDefault();
    const { buyEventId } = this.state;
    if (!buyEventId) return this.setFeedback('buyTicket', 'error', 'Enter an event ID.');
    try {
      const ev = await TicketContract.methods.getEventDetails(buyEventId).call();
      this.setState({ eventInfo: ev });
      this.setState((s) => ({ feedback: { ...s.feedback, buyTicket: null } }));
    } catch {
      this.setState({ eventInfo: null });
      this.setFeedback('buyTicket', 'error', '❌ Event not found.');
    }
  };

  onListTicket = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, resellTicketId, resellPrice } = this.state;
    if (!resellTicketId || !resellPrice)
      return this.setFeedback('resell', 'error', 'Fill in both fields.');
    this.setLoading('resell', true);
    this.setFeedback('resell', 'info', 'Step 1/2: Approving NFT… (MetaMask will pop up)');
    try {
      await TicketContract.methods
        .approve(TransferContract.options.address, resellTicketId)
        .send({ from: account });
      this.setFeedback('resell', 'info', 'Step 2/2: Listing ticket… (MetaMask will pop up)');
      await TransferContract.methods
        .listTicket(resellTicketId, toUSDC(resellPrice))
        .send({ from: account });
      this.setFeedback('resell', 'success', `✅ Ticket #${resellTicketId} listed for ${resellPrice} USDC.`);
    } catch (err) { this.setFeedback('resell', 'error', `❌ ${err.message}`); }
    this.setLoading('resell', false);
  };

  onCancelListing = async () => {
    if (!this.requireAccount()) return;
    const { account, resellTicketId } = this.state;
    if (!resellTicketId) return this.setFeedback('resell', 'error', 'Enter the Ticket ID to cancel.');
    this.setLoading('resell', true);
    this.setFeedback('resell', 'info', 'Cancelling… (MetaMask will pop up)');
    try {
      await TransferContract.methods.cancelListing(resellTicketId).send({ from: account });
      this.setFeedback('resell', 'success', `✅ Listing for ticket #${resellTicketId} cancelled.`);
    } catch (err) { this.setFeedback('resell', 'error', `❌ ${err.message}`); }
    this.setLoading('resell', false);
  };

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

  onPurchaseTicket = async () => {
    if (!this.requireAccount()) return;
    const { account, marketTicketId, marketListing } = this.state;
    if (!marketListing?.active) return this.setFeedback('market', 'error', 'Check listing first.');
    this.setLoading('market', true);
    this.setFeedback('market', 'info', 'Step 1/2: Approving USDC… (MetaMask will pop up)');
    try {
      await MockUSDC.methods
        .approve(TransferContract.options.address, marketListing.price)
        .send({ from: account });
      this.setFeedback('market', 'info', 'Step 2/2: Purchasing… (MetaMask will pop up)');
      await TransferContract.methods.purchaseTicket(marketTicketId).send({ from: account });
      this.setState({ marketListing: null });
      this.setFeedback('market', 'success',
        `✅ Ticket #${marketTicketId} purchased for ${fromUSDC(marketListing.price)} USDC!`);
      this.fetchMyTickets();
    } catch (err) { this.setFeedback('market', 'error', `❌ ${err.message}`); }
    this.setLoading('market', false);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ORGANIZER ACTIONS
  // ════════════════════════════════════════════════════════════════════════════

  onCreateEvent = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, eventName, eventDate, ticketSupply, perWalletLimit, primaryPrice, maxResalePrice } = this.state;
    if (!eventName || !eventDate || !ticketSupply || !primaryPrice || !maxResalePrice)
      return this.setFeedback('createEvent', 'error', 'Fill in all required fields.');
    this.setLoading('createEvent', true);
    this.setFeedback('createEvent', 'info', 'Creating event… (MetaMask will pop up)');
    try {
      const receipt = await TicketContract.methods.createEvent(
        eventName,
        Math.floor(new Date(eventDate).getTime() / 1000),
        parseInt(ticketSupply),
        toUSDC(primaryPrice),
        toUSDC(maxResalePrice),
        parseInt(perWalletLimit) || 0
      ).send({ from: account });
      const eventId = receipt.events?.EventCreated?.returnValues?.eventId;
      this.setFeedback('createEvent', 'success', `✅ Event created! Event ID: ${eventId ?? '—'}`);
      this.setState({ eventName: '', eventDate: '', ticketSupply: '', perWalletLimit: '', primaryPrice: '', maxResalePrice: '' });
      this.fetchAllEvents();
    } catch (err) { this.setFeedback('createEvent', 'error', `❌ ${err.message}`); }
    this.setLoading('createEvent', false);
  };

  onMintTicket = async (e) => {
    e.preventDefault();
    if (!this.requireAccount()) return;
    const { account, mintEventId, mintRecipient } = this.state;
    if (!mintEventId || !mintRecipient)
      return this.setFeedback('mint', 'error', 'Fill in both fields.');
    this.setLoading('mint', true);
    this.setFeedback('mint', 'info', 'Minting ticket… (MetaMask will pop up)');
    try {
      const receipt = await TicketContract.methods
        .mintTicket(mintEventId, mintRecipient)
        .send({ from: account });
      const ticketId = receipt.events?.TicketMinted?.returnValues?.ticketId;
      this.setFeedback('mint', 'success',
        `✅ Ticket minted! Ticket ID: ${ticketId ?? '—'} → ${short(mintRecipient)}`);
      this.setState({ mintEventId: '', mintRecipient: '' });
      this.fetchAllEvents();
    } catch (err) { this.setFeedback('mint', 'error', `❌ ${err.message}`); }
    this.setLoading('mint', false);
  };

  // ════════════════════════════════════════════════════════════════════════════
  // ADMIN ACTIONS
  // ════════════════════════════════════════════════════════════════════════════

  onPauseTC = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('tcPause', 'info', 'Pausing… (MetaMask will pop up)');
    try {
      await TicketContract.methods.pause().send({ from: this.state.account });
      this.setState({ tcPaused: true });
      this.setFeedback('tcPause', 'success', '✅ TicketContract paused.');
    } catch (err) { this.setFeedback('tcPause', 'error', `❌ ${err.message}`); }
  };

  onUnpauseTC = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('tcPause', 'info', 'Unpausing… (MetaMask will pop up)');
    try {
      await TicketContract.methods.unpause().send({ from: this.state.account });
      this.setState({ tcPaused: false });
      this.setFeedback('tcPause', 'success', '✅ TicketContract unpaused.');
    } catch (err) { this.setFeedback('tcPause', 'error', `❌ ${err.message}`); }
  };

  onPauseTR = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('trPause', 'info', 'Pausing… (MetaMask will pop up)');
    try {
      await TransferContract.methods.pause().send({ from: this.state.account });
      this.setState({ trPaused: true });
      this.setFeedback('trPause', 'success', '✅ TransferContract paused.');
    } catch (err) { this.setFeedback('trPause', 'error', `❌ ${err.message}`); }
  };

  onUnpauseTR = async () => {
    if (!this.requireAccount()) return;
    this.setFeedback('trPause', 'info', 'Unpausing… (MetaMask will pop up)');
    try {
      await TransferContract.methods.unpause().send({ from: this.state.account });
      this.setState({ trPaused: false });
      this.setFeedback('trPause', 'success', '✅ TransferContract unpaused.');
    } catch (err) { this.setFeedback('trPause', 'error', `❌ ${err.message}`); }
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
    } catch (err) { this.setFeedback('addOrg', 'error', `❌ ${err.message}`); }
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
    } catch (err) { this.setFeedback('removeOrg', 'error', `❌ ${err.message}`); }
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
    } catch (err) { this.setFeedback('addStaff', 'error', `❌ ${err.message}`); }
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
    } catch (err) { this.setFeedback('removeStaff', 'error', `❌ ${err.message}`); }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // SHARED UI HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  renderFeedback(section) {
    const fb = this.state.feedback[section];
    if (!fb) return null;
    return <div className={`vt-feedback ${fb.type}`}>{fb.msg}</div>;
  }

  // ── Events browser table ──────────────────────────────────────────────────

  renderEventsTable(events, emptyMsg = 'No events found.') {
    const { eventsLoading } = this.state;
    if (eventsLoading) {
      return <div className="empty-state"><p>Loading events…</p></div>;
    }
    if (!events.length) {
      return (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <p>{emptyMsg}</p>
        </div>
      );
    }
    return (
      <table className="vt-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Event Name</th>
            <th>Date</th>
            <th>Supply</th>
            <th>Primary Price</th>
            <th>Resale Cap</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const soldOut = Number(ev.ticketsMinted) >= Number(ev.ticketSupply);
            return (
              <tr key={ev.eventId}>
                <td className="id-cell">#{ev.eventId.toString()}</td>
                <td><strong>{ev.name}</strong></td>
                <td>{fmtDate(ev.eventDate)}</td>
                <td>{ev.ticketsMinted.toString()} / {ev.ticketSupply.toString()}</td>
                <td>{fromUSDC(ev.primaryPrice)} USDC</td>
                <td>{fromUSDC(ev.maxResalePrice)} USDC</td>
                <td>
                  <span className={`pill ${soldOut ? 'pill-red' : 'pill-green'}`}>
                    {soldOut ? 'Sold Out' : 'Available'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── My Tickets table ──────────────────────────────────────────────────────

  renderTicketsTable() {
    const { myTickets, ticketsLoading, account } = this.state;
    if (!account) {
      return (
        <div className="empty-state">
          <div className="empty-icon">🔌</div>
          <p>Connect your wallet to see your tickets.</p>
        </div>
      );
    }
    if (ticketsLoading) {
      return <div className="empty-state"><p>Loading your tickets…</p></div>;
    }
    if (!myTickets.length) {
      return (
        <div className="empty-state">
          <div className="empty-icon">🎫</div>
          <p>You don't own any tickets yet.</p>
        </div>
      );
    }
    return (
      <table className="vt-table">
        <thead>
          <tr>
            <th>Ticket ID</th>
            <th>Event</th>
            <th>Event Date</th>
            <th>Resale Cap</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {myTickets.map((t) => (
            <tr key={t.ticketId}>
              <td className="id-cell">#{t.ticketId.toString()}</td>
              <td><strong>{t.eventName}</strong></td>
              <td>{fmtDate(t.eventDate)}</td>
              <td>{fromUSDC(t.maxResalePrice)} USDC</td>
              <td>
                <span className={`pill ${t.redeemed ? 'pill-red' : 'pill-green'}`}>
                  {t.redeemed ? 'Redeemed' : 'Active'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PAGES
  // ════════════════════════════════════════════════════════════════════════════

  renderAdmin() {
    const { tcPaused, trPaused, addOrgAddr, removeOrgAddr, addStaffAddr, removeStaffAddr } = this.state;
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
      mintEventId, mintRecipient, loading, allEvents, account,
    } = this.state;

    // Show only events created by this organizer
    const myEvents = allEvents.filter(
      (ev) => ev.organizer?.toLowerCase() === account?.toLowerCase()
    );

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
                  Issue a ticket NFT directly to an attendee's wallet after receiving payment off-chain.
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

        {/* My Events browser */}
        <div className="section-header">
          <div>
            <h2>My Events</h2>
            <p>Events you have created on-chain.</p>
          </div>
          <button className="btn-refresh" onClick={this.fetchAllEvents} disabled={this.state.eventsLoading}>
            🔄 {this.state.eventsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="vt-table-wrap">
          {this.renderEventsTable(myEvents, 'You have not created any events yet.')}
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
      loading, allEvents, eventsLoading, ticketsLoading,
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

          {/* View Event Info */}
          <div className="col-12 col-md-6 col-lg-4">
            <div className="vt-card card">
              <div className="card-body">
                <h5 className="card-title"><span className="card-icon icon-blue">🔍</span>Check Event</h5>
                <p style={{ fontSize: '0.82rem', color: '#6c757d', marginBottom: '1rem' }}>
                  Look up event details by ID. Contact the organizer to purchase a primary-sale ticket.
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
                    {eventInfo.ticketsMinted.toString()} / {eventInfo.ticketSupply.toString()} sold<br />
                    Primary: {fromUSDC(eventInfo.primaryPrice)} USDC &nbsp;|&nbsp;
                    Cap: {fromUSDC(eventInfo.maxResalePrice)} USDC
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
                  List your ticket. MetaMask will pop up twice — NFT approval, then listing.
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
                  Check a listing, then purchase. MetaMask will pop up twice — USDC approval then payment.
                </p>
                <form onSubmit={this.onCheckListing}>
                  <div className="mb-3">
                    <label className="form-label">Ticket ID</label>
                    <input type="number" className="form-control" placeholder="e.g. 5" min="1"
                      value={marketTicketId}
                      onChange={(e) => this.setState({ marketTicketId: e.target.value, marketListing: null })} />
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

        {/* All Events browser */}
        <div className="section-header">
          <div>
            <h2>All Events</h2>
            <p>All events currently on-chain. Contact an organizer to purchase a primary-sale ticket.</p>
          </div>
          <button className="btn-refresh" onClick={this.fetchAllEvents} disabled={eventsLoading}>
            🔄 {eventsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="vt-table-wrap">
          {this.renderEventsTable(allEvents)}
        </div>

        {/* My Tickets browser */}
        <div className="section-header">
          <div>
            <h2>My Tickets</h2>
            <p>Tickets currently in your wallet.</p>
          </div>
          <button className="btn-refresh" onClick={() => this.fetchMyTickets()} disabled={ticketsLoading}>
            🔄 {ticketsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="vt-table-wrap">
          {this.renderTicketsTable()}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ROOT RENDER
  // ════════════════════════════════════════════════════════════════════════════

  render() {
    const { page, account, roles, rolesLoading, wrongNetwork } = this.state;
    const { isAdmin, isOrganizer } = roles;

    // Determine which tabs to show
    const showOrganizer = isAdmin || isOrganizer;
    const showAdmin     = isAdmin;

    // If current page is no longer visible, fall back to customer
    const activePage =
      (page === 'admin' && !showAdmin) ||
      (page === 'organizer' && !showOrganizer)
        ? 'customer'
        : page;

    return (
      <div>
        {/* Wrong network banner */}
        {wrongNetwork && (
          <div style={{
            background: '#e94560', color: '#fff', textAlign: 'center',
            padding: '0.6rem 1rem', fontSize: '0.88rem', fontWeight: 600,
          }}>
            ⚠️ Wrong network detected. Please switch MetaMask to <strong>Polygon Amoy</strong>.&nbsp;
            <button onClick={this.checkNetwork} style={{
              background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
              color: '#fff', borderRadius: '6px', padding: '0.15rem 0.7rem',
              fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600,
            }}>Switch Now</button>
          </div>
        )}
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
                  <a className={`nav-link ${activePage === 'customer' ? 'active' : ''}`} href="#customer">
                    Customer
                  </a>
                </li>
                {showOrganizer && (
                  <li className="nav-item">
                    <a className={`nav-link ${activePage === 'organizer' ? 'active' : ''}`} href="#organizer">
                      Organizer
                    </a>
                  </li>
                )}
                {showAdmin && (
                  <li className="nav-item">
                    <a className={`nav-link ${activePage === 'admin' ? 'active' : ''}`} href="#admin">
                      Admin
                    </a>
                  </li>
                )}
              </ul>
              <div className="d-flex align-items-center gap-2">
                {account && isAdmin     && <span className="role-indicator admin">Admin</span>}
                {account && isOrganizer && !isAdmin && <span className="role-indicator organizer">Organizer</span>}
                {rolesLoading && <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>Checking roles…</span>}
                {account && !rolesLoading && (
                  <button
                    title="Re-check your roles"
                    onClick={() => this.checkRoles(account)}
                    style={{
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
                      color: 'rgba(255,255,255,0.7)', borderRadius: '6px',
                      padding: '0.25rem 0.6rem', fontSize: '0.78rem', cursor: 'pointer',
                    }}>
                    ↻ Roles
                  </button>
                )}
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

        {activePage === 'admin'     && this.renderAdmin()}
        {activePage === 'organizer' && this.renderOrganizer()}
        {activePage === 'customer'  && this.renderCustomer()}
      </div>
    );
  }
}

export default App;
