pragma solidity 0.8.24;

import "./ZenithV2Pool.sol";

contract ZenithV2Factory {
    address public feeController;
    address public treasury;
    address public governance;

    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    address[] public allPools;

    event PoolCreated(address indexed token0, address indexed token1, uint24 indexed feeBps, address pool, uint256);
    event FeeControllerUpdated(address indexed oldFeeController, address indexed newFeeController);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    constructor(address _governance, address _feeController, address _treasury) {
        require(_governance != address(0), "ZenithV2Factory: Zero governance");
        governance = _governance;
        feeController = _feeController;
        treasury = _treasury;
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function createPool(address tokenA, address tokenB, uint24 feeBps) external returns (address pool) {
        require(tokenA != tokenB, "ZenithV2Factory: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZenithV2Factory: ZERO_ADDRESS");
        require(getPool[token0][token1][feeBps] == address(0), "ZenithV2Factory: POOL_EXISTS");
        require(feeBps > 0 && feeBps <= 1000, "ZenithV2Factory: INVALID_FEE_BPS");

        bytes memory bytecode = type(ZenithV2Pool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1, feeBps));
        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        ZenithV2Pool(pool).initialize(token0, token1, feeBps);

        getPool[token0][token1][feeBps] = pool;
        getPool[token1][token0][feeBps] = pool;
        allPools.push(pool);
        emit PoolCreated(token0, token1, feeBps, pool, allPools.length);
    }

    function setFeeController(address _feeController) external {
        require(msg.sender == governance, "ZenithV2Factory: FORBIDDEN");
        emit FeeControllerUpdated(feeController, _feeController);
        feeController = _feeController;
    }

    function setTreasury(address _treasury) external {
        require(msg.sender == governance, "ZenithV2Factory: FORBIDDEN");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }
}
