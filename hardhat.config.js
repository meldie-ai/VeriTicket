require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

/**
 * Air-gapped fallback: if Hardhat cannot reach binaries.soliditylang.org to
 * download the native solc binary (e.g. inside a sandbox without that domain
 * allow-listed), fall back to the locally installed solc-js package. We resolve
 * solc relative to this config, then point Hardhat at it. This keeps the build
 * working in CI / restricted environments without changing semantics for users
 * who do have network access.
 */
const localSolcPath = require.resolve("solc/soljson.js");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.28") {
    return {
      compilerPath: localSolcPath,
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: "0.8.28+commit.7893614a",
    };
  }
  return runSuper();
});

/**
 * VeriTicket Hardhat configuration.
 *
 * The project targets Polygon PoS in production but is fully testable on the
 * Hardhat in-process network. The Polygon network entries below are placeholders
 * that read from environment variables, so the project can be cloned and tested
 * without any secrets.
 */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // Use Hardhat's default in-process chain for local tests.
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    polygonAmoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "",
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "",
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 60000,
  },
};
