
// VeriTicket deployment script. (currently planning to deploy on Polygon Amoy)


const hre = require("hardhat");

async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log(`Deployer / admin:      ${admin.address}`);

  // Resolve USDC address - real or mock.
  let usdcAddress = process.env.USDC_ADDRESS;
  if (!usdcAddress) {
    console.log("No USDC_ADDRESS set - deploying MockUSDC for local testing.");
    const USDC = await hre.ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();
    usdcAddress = await usdc.getAddress();
    console.log(`MockUSDC deployed at:  ${usdcAddress}`);
  } else {
    console.log(`Using existing USDC at: ${usdcAddress}`);
  }

  // TicketContract
  const Ticket = await hre.ethers.getContractFactory("TicketContract");
  const ticketContract = await Ticket.deploy(admin.address);
  await ticketContract.waitForDeployment();
  const ticketAddr = await ticketContract.getAddress();
  console.log(`TicketContract:        ${ticketAddr}`);

  // 3. TransferContract
  const Transfer = await hre.ethers.getContractFactory("TransferContract");
  const transferContract = await Transfer.deploy(admin.address, ticketAddr, usdcAddress);
  await transferContract.waitForDeployment();
  const transferAddr = await transferContract.getAddress();
  console.log(`TransferContract:      ${transferAddr}`);

  // Wire TransferContract into TicketContract
  const tx = await ticketContract.setTransferContract(transferAddr);
  await tx.wait();
  console.log("TicketContract.transferContract set.");

  console.log("\nDeployment complete.");
  console.log("---------------------------------------");
  console.log(`USDC:             ${usdcAddress}`);
  console.log(`TicketContract:   ${ticketAddr}`);
  console.log(`TransferContract: ${transferAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
