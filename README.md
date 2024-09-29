# NodeArb (PyArb2)

## Overview

PyArb2 is a work-in-progress arbitrage trading bot designed to exploit price differences between Uniswap V3 and SushiSwap on the Polygon network. The bot continuously scans for arbitrage opportunities and will eventually execute trades to profit from price discrepancies.

## Features

- **Automated Arbitrage Scanning**: The bot scans for arbitrage opportunities at regular intervals.
- **Trade Execution**: (To be implemented) Executes trades on Uniswap V3 and SushiSwap to capitalize on arbitrage opportunities.
- **Flashloan Support**: (To be implemented) Utilizes flashloans to maximize trading capital without upfront liquidity.
- **Configurable Parameters**: Easily adjust trade amounts, slippage tolerance, and other parameters.

## Prerequisites

- Node.js and npm
- Solidity compiler
- A Polygon RPC URL and a private key with sufficient funds for gas fees

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/yourusername/PyArb2.git
    cd PyArb2
    ```

2. Install dependencies:
    ```sh
    npm install
    ```

3. Create a `.env` file in the root directory and add your environment variables:
    ```env
    RPC_URL=your_polygon_rpc_url
    PRIVATE_KEY=your_private_key
    ```

## Usage

### Running the Arbitrage Bot

1. Start the bot:
    ```sh
    node index.js
    ```

2. The bot will scan for arbitrage opportunities every 3 seconds and log the results to the console.

### Deploying the Flashloan Contract

1. Compile the Solidity contracts:
    ```sh
    npx hardhat compile
    ```

2. Deploy the `FlashloanV3` contract:
    ```sh
    npx hardhat run scripts/deploy.js --network polygon
    ```

3. Update the `index.js` file with the deployed contract address if necessary.

## Integration with Smart Contract

The integration with the `FlashloanV3` smart contract is currently under development. Future updates will include:

- Executing trades using flashloans.
- Handling the entire arbitrage process on-chain.

## Configuration

- **Trade Amount**: Adjust the `amountToTradeInWBTC` variable in `index.js` to change the trade amount.
- **Slippage Tolerance**: Modify the `slippageTolerance` variable in `index.js` to set the slippage tolerance.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.