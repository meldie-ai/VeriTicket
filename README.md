# VeriTicket

VeriTicket is a blockchain-based ticketing app that solves two long-standing problems in the live events industry: fake tickets and scalping.

The idea: tickets become NFTs that cannot be duplicated, the resale price is capped on-chain so scalpers cannot triple-price them, and at the door each ticket is redeemed with a one-time signature from the buyer's wallet, so a screenshotted QR code is useless.

## Stack

Solidity 0.8.28, Hardhat, OpenZeppelin Contracts v5, deployable to Polygon Amoy.

## Contracts

- `TicketContract.sol` is the NFT itself. Handles event creation, minting, and redemption.
- `TransferContract.sol` is the resale marketplace. Reads the cap from `TicketContract` and swaps USDC and the NFT in one transaction.
- `MockUSDC.sol` is a 6-decimal ERC-20 used only in tests. The real Polygon USDC address replaces it on deployment.

## Run it

```
npm install
npx hardhat test
```

To watch the full flow on a local chain:

```
npx hardhat run scripts/demo.js
```

## Deploy to Polygon Amoy

```
export POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology
export DEPLOYER_PK=0x...
export USDC_ADDRESS=0x...   # Amoy test USDC
npx hardhat run scripts/deploy.js --network polygonAmoy
```

## Layout

```
contracts/   solidity contracts
test/        hardhat tests (43 cases)
scripts/     deploy + demo scripts
docs/        bpmn diagrams, architecture diagram, slides
```

## Front End

`npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

## Author

Minsel Choirog, N12193046
Jayden Manton, N10475176
2026
