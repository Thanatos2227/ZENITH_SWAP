pragma solidity 0.8.24;

import "./ZenithV1Pair.sol";

contract ZenithV1Factory {
    address public feeTo;
    address public feeToSetter;

    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    constructor(address _feeToSetter, address _initialFeeTo) {
        require(_feeToSetter != address(0), "ZenithV1Factory: Zero feeToSetter");
        feeToSetter = _feeToSetter;
        feeTo = _initialFeeTo;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "ZenithV1Factory: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZenithV1Factory: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "ZenithV1Factory: PAIR_EXISTS");

        bytes memory bytecode = type(ZenithV1Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        ZenithV1Pair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external {
        require(msg.sender == feeToSetter, "ZenithV1Factory: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external {
        require(msg.sender == feeToSetter, "ZenithV1Factory: FORBIDDEN");
        require(_feeToSetter != address(0), "ZenithV1Factory: ZERO_ADDRESS");
        feeToSetter = _feeToSetter;
    }
}
