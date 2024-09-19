require('dotenv').config();
const { ethers } = require('ethers');

// Provider and Signer setup
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Token and contract addresses on Polygon
const WBTC_ADDRESS = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6';  // WBTC address on Polygon
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';   // WETH address on Polygon
const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const UNISWAP_V3_QUOTER_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // Uniswap V3 Quoter on Polygon
const SUSHISWAP_ROUTER_ADDRESS = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';  // SushiSwap Router on Polygon

const chainId = 137;  // Polygon Chain ID

// Token decimals
const WBTC_DECIMALS = 8;  // WBTC has 8 decimals
const WETH_DECIMALS = 18; // WETH has 18 decimals

// Import ABIs
const { abi: UNISWAP_V3_FACTORY_ABI } = require('./artifacts/UniswapV3Factory.json');
const { abi: UNISWAP_V3_POOL_ABI } = require('./artifacts/UniswapV3Pool.json');
const SUSHISWAP_ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
];
const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
];

// **Configurable Trade Amount and Slippage**
const amountToTradeInWBTC = '0.00032'; // Approximately $20 USD at $62k BTC (adjust as needed)
const slippageTolerance = 0.005;     // 0.5% slippage tolerance

// Initialize Contracts
const quoterContract = new ethers.Contract(UNISWAP_V3_QUOTER_ADDRESS, QUOTER_ABI, provider);
const sushiRouterContract = new ethers.Contract(SUSHISWAP_ROUTER_ADDRESS, SUSHISWAP_ROUTER_ABI, provider);

// Helper function to apply fees and slippage
function calculateAmountAfterFeesAndSlippage(amount, feePercent, slippage) {
    const amountAfterFees = amount * (1 - feePercent);
    const amountAfterSlippage = amountAfterFees * (1 - slippage);
    return amountAfterSlippage;
}

// **Remove Per-Unit Price Functions**
// Eliminated getUniswapV3PerUnitPrice and getSushiSwapPerUnitPrice
// Instead, use trade-based price functions that account for price impact

// Function to get Uniswap V3 trade price (WETH for fixed WBTC)
async function getUniswapV3TradePrice(amountInWBTC) {
    const feeTier = 500; // 0.05% fee tier for Uniswap V3
    const uniswapFee = 0.0005; // 0.05% fee

    // Convert amountInWBTC to smallest unit (8 decimals)
    const amountIn = ethers.utils.parseUnits(amountInWBTC.toString(), WBTC_DECIMALS);

    try {
        // Ensure the pool exists
        const factoryContract = new ethers.Contract(UNISWAP_V3_FACTORY_ADDRESS, UNISWAP_V3_FACTORY_ABI, provider);
        const poolAddress = await factoryContract.getPool(WBTC_ADDRESS, WETH_ADDRESS, feeTier);

        if (poolAddress === ethers.constants.AddressZero) {
            throw new Error(`Pool does not exist for the WBTC/WETH pair with ${feeTier} fee tier.`);
        }

        // Proceed with the quoter call
        const amountOut = await quoterContract.callStatic.quoteExactInputSingle(
            WBTC_ADDRESS,
            WETH_ADDRESS,
            feeTier,
            amountIn,
            0 // No price limit
        );

        // Convert amountOut from WETH (18 decimals) to number
        let wethAmount = parseFloat(ethers.utils.formatUnits(amountOut, WETH_DECIMALS));

        // Apply Uniswap fee and slippage
        wethAmount = calculateAmountAfterFeesAndSlippage(wethAmount, uniswapFee, slippageTolerance);

        // Calculate effective per-unit price
        const effectivePrice = wethAmount / parseFloat(amountToTradeInWBTC);

        return { totalWETH: wethAmount, effectivePrice };
    } catch (error) {
        console.error('Error fetching Uniswap V3 trade price:', error);
        return { totalWETH: null, effectivePrice: null };
    }
}

// Function to get SushiSwap trade price (WETH for fixed WBTC)
async function getSushiSwapTradePrice(amountInWBTC) {
    const sushiFee = 0.003; // 0.3% fee for SushiSwap

    // Convert amountInWBTC to smallest unit (8 decimals)
    const amountIn = ethers.utils.parseUnits(amountInWBTC.toString(), WBTC_DECIMALS);
    const path = [WBTC_ADDRESS, WETH_ADDRESS]; // WBTC -> WETH

    try {
        const amountsOut = await sushiRouterContract.getAmountsOut(amountIn, path);
        const amountOutWETH = amountsOut[1]; // Get the output amount in WETH

        // Convert the WETH amount from 18 decimals to number
        let wethAmount = parseFloat(ethers.utils.formatUnits(amountOutWETH, WETH_DECIMALS));

        // Apply SushiSwap fee and slippage
        wethAmount = calculateAmountAfterFeesAndSlippage(wethAmount, sushiFee, slippageTolerance);

        // Calculate effective per-unit price
        const effectivePrice = wethAmount / parseFloat(amountToTradeInWBTC);

        return { totalWETH: wethAmount, effectivePrice };
    } catch (error) {
        console.error('Error fetching SushiSwap trade price:', error);
        return { totalWETH: null, effectivePrice: null };
    }
}

// **Execute Arbitrage Using Trade-Based Prices**
async function executeArbitrage() {
    try {
        // Fetch trade prices concurrently
        const [uniswapTrade, sushiTrade] = await Promise.all([
            getUniswapV3TradePrice(amountToTradeInWBTC),
            getSushiSwapTradePrice(amountToTradeInWBTC)
        ]);

        const { totalWETH: uniswapTradePrice, effectivePrice: uniswapPerUnitPrice } = uniswapTrade;
        const { totalWETH: sushiTradePrice, effectivePrice: sushiPerUnitPrice } = sushiTrade;

        // Output the trade-based prices
        console.log(`\n--- Effective Price for ${amountToTradeInWBTC} WBTC to WETH ---`);
        console.log(`Uniswap V3: ${uniswapPerUnitPrice !== null ? uniswapPerUnitPrice.toFixed(6) : 'N/A'} WETH per WBTC`);
        console.log(`SushiSwap:  ${sushiPerUnitPrice !== null ? sushiPerUnitPrice.toFixed(6) : 'N/A'} WETH per WBTC`);
        console.log(`Percent Difference: ${(Math.abs(uniswapPerUnitPrice - sushiPerUnitPrice) / ((uniswapPerUnitPrice + sushiPerUnitPrice) / 2) * 100).toFixed(2)}%`);

        // Compute Arbitrage PnL
        if (uniswapTradePrice !== null && sushiTradePrice !== null) {
            // Gross PnL: Difference in WETH received
            const pnlSushiToUniswap = uniswapTradePrice - sushiTradePrice;
            const pnlUniswapToSushi = sushiTradePrice - uniswapTradePrice;

            // Determine which scenario yields positive PnL
            let arbitrageOpportunity = '';
            let pnl = 0;
            let grossPnl = 0;

            if (pnlSushiToUniswap > 0.0001) { // Threshold for significance
                arbitrageOpportunity = 'Buy on SushiSwap, Sell on Uniswap V3!';
                grossPnl = pnlSushiToUniswap;
                pnl = grossPnl; // Fees and slippage are already deducted
            } else if (pnlUniswapToSushi > 0.0001) {
                arbitrageOpportunity = 'Buy on Uniswap V3, Sell on SushiSwap!';
                grossPnl = pnlUniswapToSushi;
                pnl = grossPnl; // Fees and slippage are already deducted
            } else {
                arbitrageOpportunity = 'No Significant Arbitrage Opportunity Detected.';
            }

            // Output Arbitrage Details
            if (pnl !== 0) {
                console.log(`\n--- Arbitrage Opportunity Detected ---`);
                console.log(`Arbitrage Opportunity: ${arbitrageOpportunity}`);
                console.log(`Gross PnL for ${amountToTradeInWBTC} WBTC traded: ${grossPnl.toFixed(6)} WETH`);
                console.log(`Final Net PnL (after fees and slippage): ${pnl.toFixed(6)} WETH`);
                console.log(`\nTrade Details:`);
                console.log(`- Uniswap V3: Received ${uniswapTradePrice.toFixed(6)} WETH for ${amountToTradeInWBTC} WBTC`);
                console.log(`- SushiSwap:  Received ${sushiTradePrice.toFixed(6)} WETH for ${amountToTradeInWBTC} WBTC`);
            } else {
                console.log(`\n${arbitrageOpportunity}`);
            }

            // Additionally, show percent difference
            const averagePrice = (uniswapPerUnitPrice + sushiPerUnitPrice) / 2;
            const percentDifference = ((Math.abs(pnl)) / averagePrice) * 100;
            console.log(`\nPercent Difference between Uniswap and SushiSwap: ${percentDifference.toFixed(2)}%`);
        } else {
            console.log('\nUnable to compute PnL due to missing trade price data.');
        }
    } catch (err) {
        console.error('Error in executing arbitrage:', err);
    }
}

// Function to scan for arbitrage opportunities
async function scanForArbitrage() {
    console.log('\nScanning for Arbitrage Opportunities...');
    await executeArbitrage();
}

// **Run the arbitrage scanning function at regular intervals**
setInterval(scanForArbitrage, 3000); // Run every 3 seconds