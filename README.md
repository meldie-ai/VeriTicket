# VeriTicket

VeriTicket is a blockchain-based ticketing app that solves two long-standing problems in the live events industry: fake tickets and scalping.

The idea: tickets become NFTs that cannot be duplicated, the resale price is capped on-chain so scalpers cannot triple-price them, and at the door each ticket is redeemed with a one-time signature from the buyer's wallet, so a screenshotted QR code is useless.

## Stack

Solidity 0.8.28, Hardhat, OpenZeppelin Contracts v5, deployed to Polygon Amoy.

## Contracts

- `TicketContract.sol` is the NFT itself. Handles event creation, minting, and redemption.
- `TransferContract.sol` is the resale marketplace. Reads the cap from `TicketContract` and swaps USDC and the NFT in one transaction.
- `MockUSDC.sol` is a 6-decimal ERC-20 used for development.

## Deployed contracts (Polygon Amoy testnet)

Contract:          Address                                     

TicketContract:   `0x16222a6dd924FB26C420708984E66De9A021512B`
TransferContract: `0xcD9AE872B54022b31185A7Dfd2598115926b18d2`
MockUSDC:         `0x6aC7a97bDA650aC1661831c3C2d59C5BC84A86FC`

## Layout

```
contracts/   Solidity contracts
test/        Hardhat tests (43 cases across 3 files)
scripts/     deploy + demo scripts
docs/        BPMN diagrams, architecture diagram
src/         React frontend
```

---

## How to run the tests

### Prerequisites

- Node.js v18 or later (`node --version` to check)
- npm v9 or later

### Steps

```bash
# 1. Clone the repo and install dependencies
git clone https://github.com/your-org/VeriTicket.git
cd VeriTicket
npm install

# 2. Run the full test suite (43 tests, ~10 seconds on a local Hardhat chain)
npx hardhat test
```

You should see something like:

```
  TicketContract
    admin can approve and revoke organiser
    organiser can create an event
    ... (27 tests)

  TransferContract
    seller can list a ticket
    buyer can purchase a listed ticket
    ... (12 tests)

  MockUSDC
    anyone can mint
    ... (4 tests)

  43 passing (9s)
```

### Run a single test file

```bash
npx hardhat test test/TicketContract.test.js
npx hardhat test test/TransferContract.test.js
npx hardhat test test/MockUSDC.test.js
```

### Run tests matching a keyword

```bash
npx hardhat test --grep "resale cap"
```

### Watch the full flow on a local chain

```bash
npx hardhat run scripts/demo.js
```

Runs through the whole flow - create event, mint ticket, list it, buy it, redeem it.

---

## How to run the app locally

### Prerequisites

- Node.js v18 or later
- [MetaMask](https://metamask.io/) browser extension installed
- A MetaMask wallet funded with Amoy MATIC for gas (free from the [Polygon faucet](https://faucet.polygon.technology/))

### 1. Add Polygon Amoy to MetaMask

Open MetaMask → Settings → Networks → Add a network manually:

Field            Value                                 

Network name     Polygon Amoy               
RPC URL          `https://rpc-amoy.polygon.technology`
Chain ID         `80002`                             
Currency symbol  `MATIC/POL`                            
Block explorer   `https://amoy.polygonscan.com`       

### 2. Install and start the frontend

```bash
cd VeriTicket
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in the same browser that has MetaMask installed.

### 3. Connect your wallet

Click **Connect Wallet** at the top of the page. MetaMask will prompt you to connect — approve it. Make sure MetaMask is set to the **Polygon Amoy** network, or the app will show a network warning.

### 4. Use the app

The app has four panels depending on your role:

The **admin panel** only shows up if your wallet has the admin role. From there you can approve organisers, add door staff, or hand the admin role to someone else.

The **organiser panel** is for approved organisers. You create events here (set the supply, price, resale cap, per-wallet limit) and mint tickets to buyer wallets.

The **buyer panel** is for everyone else. You can list a ticket for resale, cancel a listing, or buy someone else's listing. Before listing you need to approve TransferContract to move the NFT — the UI has a button for that. Before buying you need MockUSDC, which you can mint from the Mint USDC button, then approve TransferContract to spend it.

The **staff panel** is for door staff. The ticket holder signs a one-time challenge in their MetaMask, and the staff wallet submits it here to redeem the ticket.

### MetaMask gas (Amoy is picky)

Amoy rejects transactions below 25 Gwei priority fee, and MetaMask sometimes estimates a gas limit way over the block cap. If a transaction fails for either reason, click **Edit → Advanced** in the MetaMask popup and manually set Max priority fee to `30` Gwei and Gas limit to `500000`.

---

## Deploy to Polygon Amoy

```bash
export POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
export DEPLOYER_PK=0x...          # deployer private key
export USDC_ADDRESS=0x...         # MockUSDC or real USDC address on Amoy
npx hardhat run scripts/deploy.js --network polygonAmoy
```

The deployed addresses are printed to the console and must be pasted into `src/TicketContract.js`, `src/TransferContract.js`, and `src/MockUSDC.js`.

---

## Live deployment

[https://veri-ticket.vercel.app](https://veri-ticket.vercel.app)

---

## Author

Minsel Choirog, N12193046 (Completed 60% of project)

Jayden Manton, N10475176 (Completed 40% of project)

2026
