// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./utils/FlashLoanReceiverBaseV2.sol";
import "./utils/Withdrawable.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol"; // For SushiSwap Router

contract FlashloanV3 is FlashLoanReceiverBaseV2, Withdrawable {

    address immutable uniswapRouterAddress;
    address immutable sushiswapRouterAddress;
    address immutable uniswapFactoryAddress;

    uint24 constant UNISWAP_FEE_TIER = 500; // Hardcoded 0.05% fee for Uniswap V3

    constructor(
        address _addressProvider,
        address _uniswapRouterAddress,
        address _sushiswapRouterAddress,
        address _uniswapFactoryAddress
    ) FlashLoanReceiverBaseV2(_addressProvider) {
        uniswapRouterAddress = _uniswapRouterAddress;
        sushiswapRouterAddress = _sushiswapRouterAddress;
        uniswapFactoryAddress = _uniswapFactoryAddress;
    }

    enum Exchange {
        UNISWAP,
        SUSHI,
        NONE
    }

    // *** Flashloan Execution ***

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address /* initiator */,
        bytes calldata params
    )
        external
        override
        returns (bool)
    {
        require(msg.sender == address(LENDING_POOL), "Not pool");

        address borrowedAsset = assets[0];
        uint256 borrowedAmount = amounts[0];
        uint256 premiumAmount = premiums[0];

        (address swappingPair) = abi.decode(params, (address));

        // Perform arbitrage
        uint256 amountFinal = executeArbitrage(borrowedAsset, borrowedAmount, swappingPair);

        // Repay the flash loan with the premium
        uint256 amountOwing = borrowedAmount + premiumAmount;
        IERC20(borrowedAsset).approve(address(LENDING_POOL), amountOwing);
        return true;
    }

    function startTransaction(
        address _borrowAsset,
        uint256 _borrowAmount,
        address _swappingPair
    ) public onlyOwner {
        bytes memory params = abi.encode(_swappingPair);
        _getFlashloan(_borrowAsset, _borrowAmount, params);
    }

    function _getFlashloan(address _asset, uint256 _amount, bytes memory _params) internal {
        // Initialize assets array with one element
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        // Initialize amounts array with one element
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = _amount;

        _flashloan(assets, amounts, _params);
    }

    function _flashloan(address[] memory assets, uint256[] memory amounts, bytes memory params) internal {
        address receiverAddress = address(this);
        address onBehalfOf = address(this);
        uint16 referralCode = 0;

        uint256[] memory modes = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            modes[i] = 0;
        }

        LENDING_POOL.flashLoan(
            receiverAddress,
            assets,
            amounts,
            modes,
            onBehalfOf,
            params,
            referralCode
        );
    }

    // *** Arbitrage Execution ***

    function executeArbitrage(
        address _borrowedAsset,
        uint256 _borrowedAmount,
        address _swappingPair
    ) internal returns (uint256) {
        // Example path for SushiSwap
        address[] memory sushiPath = new address[](2);
        sushiPath[0] = _borrowedAsset; // Token being sold
        sushiPath[1] = _swappingPair;  // Token being bought

        // Optimistically perform swaps
        uint256 amountFinal;

        // Perform Uniswap swap first
        uint256 amountOut = _uniswapSwap(_borrowedAmount, _borrowedAsset, _swappingPair);
        amountFinal = _sushiswapSwap(amountOut, sushiPath);

        return amountFinal;
    }

    // *** Uniswap Functions ***

    function _uniswapSwap(
        uint256 amountIn,
        address sellToken,
        address buyToken
    ) internal returns (uint256) {
        ISwapRouter swapRouter = ISwapRouter(uniswapRouterAddress);
        IERC20(sellToken).approve(uniswapRouterAddress, amountIn);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: sellToken,
            tokenOut: buyToken,
            fee: UNISWAP_FEE_TIER,
            recipient: address(this),
            deadline: block.timestamp + 300,
            amountIn: amountIn,
            amountOutMinimum: 0, // Add slippage tolerance here
            sqrtPriceLimitX96: 0
        });

        uint256 amountReceived = swapRouter.exactInputSingle(params);
        return amountReceived;
    }

    // *** SushiSwap Functions ***

    function _sushiswapSwap(
        uint256 amountIn,
        address[] memory path
    ) internal returns (uint256) {
        IUniswapV2Router02 sushiswapRouter = IUniswapV2Router02(sushiswapRouterAddress);
        IERC20(path[0]).approve(sushiswapRouterAddress, amountIn);

        uint256[] memory amounts = sushiswapRouter.swapExactTokensForTokens(
            amountIn,
            0, // amountOutMin (you can set slippage tolerance here)
            path,
            address(this),
            block.timestamp + 300
        );

        return amounts[amounts.length - 1]; // Return the final output amount
    }

    // *** Utility ***

    function poolExists(address tokenA, address tokenB, uint24 feeTier) public view returns (bool) {
        IUniswapV3Factory factory = IUniswapV3Factory(uniswapFactoryAddress);
        address pool = factory.getPool(tokenA, tokenB, feeTier);
        return pool != address(0);
    }
}