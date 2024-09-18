import json
import time
from web3 import Web3
import os
from dotenv import load_dotenv

# Constants
load_dotenv()

INFURA_URL = os.getenv('INFURA_URL')
UNISWAP_V3_FACTORY_ADDRESS = Web3.to_checksum_address('0x1F98431c8aD98523631AE4a59f267346ea31F984')

USDC_ADDRESS = Web3.to_checksum_address('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')  # USDC Mainnet Address
WETH_ADDRESS = Web3.to_checksum_address('0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619')  # WETH Mainnet Address

FEE_TIERS = [500, 3000]  # 0.05% and 0.3% in basis points
ARBITRAGE_THRESHOLD = 0.0000005  # Define your lower threshold for price difference

TRADE_AMOUNT = 1000.0  # Trade amount in USD
COMBINED_FEE = 0.05  # Combined fee in USD for both buy and sell trades
MAX_SLIPPAGE = 0.01  # Maximum slippage percentage

# Initialize Web3
web3 = Web3(Web3.HTTPProvider(INFURA_URL))

# Load ABIs
with open('artifacts/UniswapV3Factory.json') as f:
    factory_abi = json.load(f)['abi']

with open('artifacts/UniswapV3Pool.json') as f:
    pool_abi = json.load(f)['abi']

# Token Decimals Cache
TOKEN_DECIMALS = {}

def get_token_decimals(token_address):
    if token_address in TOKEN_DECIMALS:
        return TOKEN_DECIMALS[token_address]
    else:
        erc20_abi = [{
            "constant": True,
            "inputs": [],
            "name": "decimals",
            "outputs": [{"name": "", "type": "uint8"}],
            "type": "function",
        }]
        token_contract = web3.eth.contract(address=token_address, abi=erc20_abi)
        decimals = token_contract.functions.decimals().call()
        TOKEN_DECIMALS[token_address] = decimals
        return decimals

# Function to get the pool address for the given token pair and fee tier
def get_pool_address(tokenA, tokenB, fee):
    factory_contract = web3.eth.contract(address=UNISWAP_V3_FACTORY_ADDRESS, abi=factory_abi)
    pool_address = factory_contract.functions.getPool(tokenA, tokenB, fee).call()
    return pool_address

# Function to get the sqrtPriceX96 and token addresses from the pool
def get_pool_sqrt_price_and_tokens(pool_address):
    pool_contract = web3.eth.contract(address=pool_address, abi=pool_abi)
    slot0 = pool_contract.functions.slot0().call()
    sqrt_price_x96 = slot0[0]
    token0 = pool_contract.functions.token0().call()
    token1 = pool_contract.functions.token1().call()
    return sqrt_price_x96, token0, token1

# Function to convert sqrtPriceX96 to price, adjusted for token decimals
def sqrt_price_x96_to_price(sqrt_price_x96, decimals_token0, decimals_token1):
    price = (sqrt_price_x96 / (2 ** 96)) ** 2
    adjusted_price = price * (10 ** (decimals_token0 - decimals_token1))
    return adjusted_price

# Function to fetch prices from the pools
def get_prices():
    prices = {}
    for fee in FEE_TIERS:
        pool_address = get_pool_address(USDC_ADDRESS, WETH_ADDRESS, fee)
        if pool_address == '0x0000000000000000000000000000000000000000':
            print(f"No pool found for fee tier {fee}")
            continue
        sqrt_price_x96, token0, token1 = get_pool_sqrt_price_and_tokens(pool_address)
        decimals_token0 = get_token_decimals(token0)
        decimals_token1 = get_token_decimals(token1)
        price = sqrt_price_x96_to_price(sqrt_price_x96, decimals_token0, decimals_token1)
        prices[fee] = price
    return prices

# Function to check for arbitrage opportunities
def check_arbitrage(prices):
    if len(prices) < 2:
        print("Not enough price data to compare.")
        return None
    
    fees = list(prices.keys())
    fee_a, fee_b = fees[0], fees[1]
    price_a, price_b = prices[fee_a], prices[fee_b]

    # Calculate price difference and percentage arbitrage
    price_difference = abs(price_a - price_b)
    percent_arbitrage = (price_difference / min(price_a, price_b)) * 100

    # Set your acceptable slippage percentage
    
    # Adjust trade amount based on slippage
    effective_trade_amount_a = TRADE_AMOUNT / (1 + MAX_SLIPPAGE)
    effective_trade_amount_b = TRADE_AMOUNT * (1 - MAX_SLIPPAGE)

    # Calculate potential PnL considering slippage and fees
    if price_a < price_b:
        potential_profit = ((effective_trade_amount_a / price_a) * price_b) - TRADE_AMOUNT - COMBINED_FEE
    else:
        potential_profit = ((effective_trade_amount_b / price_b) * price_a) - TRADE_AMOUNT - COMBINED_FEE

    if price_difference > ARBITRAGE_THRESHOLD and potential_profit > 0:
        print(f"Arbitrage opportunity detected!")
        print(f"Price at fee {fee_a}: {price_a}")
        print(f"Price at fee {fee_b}: {price_b}")
        print(f"Price difference: {price_difference}")
        print(f"Percentage arbitrage: {percent_arbitrage:.6f}%")
        print(f"Potential PnL for ${TRADE_AMOUNT} trade: ${potential_profit:.4f}")

        return {
            'timestamp': int(time.time()),
            'fee_tier_a': fee_a,
            'fee_tier_b': fee_b,
            'price_a': price_a,
            'price_b': price_b,
            'price_difference': price_difference,
            'percent_arbitrage': percent_arbitrage,
            'potential_pnl': potential_profit
        }
    else:
        print(f"No arbitrage opportunity. Price difference ({price_difference}) is below threshold.")
        print(f"Current prices: {prices}, potential profit: {potential_profit}")
        return None


# Main function
def main():
    print("Starting arbitrage bot...")
    while True:
        try:
            prices = get_prices()
            arbitrage_data = check_arbitrage(prices)
            if arbitrage_data:
                # Log to console
                print("Profitable arbitrage opportunity found!")
                # Append to jsonl file
                with open('arbitrage_opportunities.jsonl', 'a') as f:
                    json.dump(arbitrage_data, f)
                    f.write('\n')
            # Wait for a certain interval before checking again
            time.sleep(2)  # Adjust the sleep time as needed
        except Exception as e:
            print(f"An error occurred: {e}")
            time.sleep(2)

if __name__ == '__main__':
    main()