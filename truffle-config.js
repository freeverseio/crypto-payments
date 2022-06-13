require('dotenv').config();
// eslint-disable-next-line no-unused-vars
const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  compilers: {
    solc: {
      version: '0.8.14', // A version or constraint - Ex. "^0.5.0"
      // Can also be set to "native" to use a native solc
      parser: 'solcjs', // Leverages solc-js purely for speedy parsing
      settings: {
        optimizer: {
          enabled: true,
        },
      },
    },
  },
  plugins: [
    'truffle-plugin-verify',
  ],
  api_keys: {
    polygonscan: process.env.POLYGONSCAN_API_KEY,
  },
  networks: {
    // to test a deploy:
    // 1. uncomment the ganache network part.
    // 2. "ganache-cli -d"
    // 3. "truffle migrate  --network ganache --network_id 1337"
    // ganache: {
    //   provider: new HDWalletProvider(
    //     [
    //       '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
    //       '0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1',
    //       '0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c',
    //       '0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913',
    //       '0xadd53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743',
    //       '0xadd53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743',
    //       '0x395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd',
    //       '0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52',
    //       '0xa453611d9419d0e56f499079478fd72c37b251a94bfde4d19872c44cf65386e3',
    //       '0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4',
    //       '0xb0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773',
    //     ],
    //     'http://127.0.0.1:8545/',
    //   ),
    //   networkCheckTimeout: 1000000,
    //   timeoutBlocks: 5000, // # of blocks before a deployment times out  (minimum/default: 50)
    //   gasPrice: 20000000000,
    //   network_id: '1337',
    //   paymentsData: {
    //     currencyDescriptor: 'GanacheCoin',
    //   },
    // },

    // matic: {
    //   provider: new HDWalletProvider(
    //     process.env.DEPLOYER_MNEMONIC,
    //     'https://matic-mainnet.chainstacklabs.com',
    //   ),
    //   network_id: 137,
    //   gasPrice: 70000000000, // fast = 5000000000, slow = 1000000000
    //   confirmations: 1,
    //   paymentsData: {
    //     currencyDescriptor: 'MATIC',
    //   },
    //   skipDryRun: true,
    // },

    // Try these Mumbai nodes:
    // - 'https://rpc-mumbai.maticvigil.com'
    // - 'https://matic-mumbai.chainstacklabs.com'
    // matictestnet: {
    //   provider: new HDWalletProvider(
    //     process.env.DEPLOYER_MNEMONIC,
    //     'https://matic-mumbai.chainstacklabs.com',
    //   ),
    //   network_id: 80001,
    //   confirmations: 1,
    //   skipDryRun: true,
    //   paymentsData: {
    //     currencyDescriptor: 'MATIC on Mumbai',
    //   },
    // },
    // xdai: { // 0xA9c0F76cA045163E28afDdFe035ec76a44f5C1F3
    //   provider: new HDWalletProvider(
    //     [
    //       process.env.DEPLOYER_MNEMONIC,
    //       process.env.ASSET_OWNER_MNEMONIC
    //     ],
    //     'https://rpc.xdaichain.com/', // others: http://xdai.blackhole.gorengine.com:51943/ wss://xdai.poanetwork.dev/wss http://xdai.poanetwork.dev/ wss://rpc.xdaichain.com/wss
    //   ),
    //   network_id: 100,
    //   gasPrice: 5000000000, // fast = 5000000000, slow = 1000000000
    //   paymentsData: {
    //     currencyDescriptor: 'xDai',
    //   },
    //   networkCheckTimeout: 1000000,
    //   timeoutBlocks: 5000, // # of blocks before a deployment times out  (minimum/default: 50)
    // },

    // Set default mocha options here, use special reporters etc.
    // mocha: {
    //   reporter: 'eth-gas-reporter',
    //   timeout: 100000
    // }
  },
};
