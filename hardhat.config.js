require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const localSolcPath = require.resolve("solc/soljson.js");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.28") {
    return { compilerPath: localSolcPath, isSolcJs: true, version: args.solcVersion, longVersion: "0.8.28+commit.7893614a" };
  }
  return runSuper();
});

module.exports = {
  solidity: { version: "0.8.28", settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    polygonAmoy: { url: process.env.POLYGON_AMOY_RPC_URL || "", accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [] },
    polygon: { url: process.env.POLYGON_RPC_URL || "", accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [] },
  },
  etherscan: { apiKey: process.env.POLYGONSCAN_API_KEY || "" },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
  mocha: { timeout: 60000 },
};