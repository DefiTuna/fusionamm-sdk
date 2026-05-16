# FusionAMM

FusionAMM is a hybrid (CLMM + OrderBook) AMM contract on the Solana blockchain.
This repository contains the Rust smart contract and SDKs to interact with a deployed program.

The official deployment of the FusionAMM contract can be found at the `fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9`
address on:

- [Solana Mainnet](https://solscan.io/account/fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9)
- [Solana Devnet](https://solscan.io/account/fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9?cluster=devnet)

## Usage

This repository contains several libraries that can be used to interact with the FusionAMM contract. For most purposes
you can use our high-level SDKs, `@crypticdot/fusionamm` for Typescript projects, and `fusionamm` for Rust
projects.

For specific use-cases you can opt for integrating with lower level packages such as:

* `@crypticdot/fusionamm-client` & `fusionamm-client` - auto-generated client for the FusionAMM program that
  contains account, instruction and error parsing.
* `@crypticdot/fusionamm-core` & `fusionamm-core` - utility, math and quoting functions used by other packages.

## Local Development

This monorepo contains all the code needed to build, deploy and interact with the FusionAMM contract.

### Requirements

- Solana 2.3.11
- Anchor 0.32.1

```
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

### Deployment

Useful commands

```
// IDL init and upgrade:
anchor idl init --filepath ./target/idl/fusionamm.json fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9
anchor idl upgrade --filepath ./target/idl/fusionamm.json fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9

// Deploying:
solana program deploy ./target/deploy/fusionamm.so
solana-keygen recover -o ./recover.json
solana program deploy --buffer ./recover.json ./target/deploy/fusionamm.so

// Writing the program to a bufffer:
solana program write-buffer ./target/deploy/fusionamm.so
solana-keygen recover -o ./recover.json
solana program write-buffer --buffer ./recover.json ./target/deploy/fusionamm.so
```

## License

The code in this repository is licensed under the **FusionAMM SDK Source-Available License v1.0**.  
See [`LICENSE`](LICENSE) for full terms.

The repository includes portions of code originally licensed under the Apache License 2.0 by Orca.so
(https://github.com/orca-so/whirlpools,
commit [e528dd2](https://github.com/orca-so/whirlpools/tree/e528dd23bb41571f92cfdb49a2f15d4fa0b01bec)) and used in
compliance with its terms prior to February 26, 2025.
See the Apache License, Version 2.0 for details at: http://www.apache.org/licenses/LICENSE-2.0.

### Commercial Licensing

If you wish to:

- Use this SDK in modified form
- Integrate in a way that falls outside this license
- Build a tool or service around the SDK

Please contact us at **[info@fusionamm.com](mailto:info@fusionamm.com)**.