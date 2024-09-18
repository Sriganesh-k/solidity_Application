module.exports = {
  // Networks define how you connect to your ethereum client and let you set the
  // defaults web3 uses to send transactions. If you don't specify one, Truffle
  // will spin up a managed Ganache instance for you on port 9545 when you
  // run `develop` or `test`. You can ask a truffle command to use a specific
  // network from the command line, e.g
  //
  // $ truffle test --network <network-name>

  networks: {
    // Configure development network for Ganache
    development: {
      host: "127.0.0.1",     // Localhost
      port: 8545,            // Ganache's default RPC port
      network_id: "*",    // Ganache's network id (1337)
    },

    // Additional networks can be configured here, such as for mainnet, testnets, etc.
    // Example of configuration for deploying to the Goerli testnet via Infura
    // goerli: {
    //   provider: () => new HDWalletProvider(MNEMONIC, `https://goerli.infura.io/v3/${PROJECT_ID}`),
    //   network_id: 5,       // Goerli's id
    //   confirmations: 2,    // # of confirmations to wait between deployments. (default: 0)
    //   timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
    //   skipDryRun: true     // Skip dry run before migrations? (default: false for public nets )
    // },
  },

  // Set default mocha options here, use special reporters, etc.
  mocha: {
    timeout: 100000, // You can change this value if you run long tests
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.8.21",      // Match this to your Solidity version
    }
  },

  // Truffle DB settings (currently disabled)
  db: {
    enabled: false,
  }
};
