pragma solidity 0.8.24;

import "./ZenithV3Pool.sol";

contract ZenithV3Factory {
    address public owner;
    mapping(uint24 => int24) public feeAmountTickSpacing;
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    address[] public allPools;

    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
        address pool
    );
    event FeeAmountEnabled(uint24 indexed fee, int24 indexed tickSpacing);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ZenithV3Factory: FORBIDDEN");
        _;
    }

    constructor(address _owner) {
        require(_owner != address(0), "ZenithV3Factory: Zero owner");
        owner = _owner;

        _enableFeeAmount(100, 1);
        _enableFeeAmount(500, 10);
        _enableFeeAmount(3000, 60);
        _enableFeeAmount(10000, 200);
    }

    function _enableFeeAmount(uint24 fee, int24 tickSpacing) internal {
        feeAmountTickSpacing[fee] = tickSpacing;
        emit FeeAmountEnabled(fee, tickSpacing);
    }

    function enableFeeAmount(uint24 fee, int24 tickSpacing) external onlyOwner {
        require(fee < 1000000, "ZenithV3Factory: FEE_BOUND");
        require(tickSpacing > 0 && tickSpacing < 16384, "ZenithV3Factory: TICK_SPACING_BOUND");
        require(feeAmountTickSpacing[fee] == 0, "ZenithV3Factory: FEE_ALREADY_ENABLED");
        _enableFeeAmount(fee, tickSpacing);
    }

    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool) {
        require(tokenA != tokenB, "ZenithV3Factory: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZenithV3Factory: ZERO_ADDRESS");
        int24 tickSpacing = feeAmountTickSpacing[fee];
        require(tickSpacing != 0, "ZenithV3Factory: FEE_NOT_ENABLED");
        require(getPool[token0][token1][fee] == address(0), "ZenithV3Factory: POOL_EXISTS");

        bytes memory bytecode = type(ZenithV3Pool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1, fee));
        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        ZenithV3Pool(pool).initializePool(token0, token1, fee, tickSpacing);

        getPool[token0][token1][fee] = pool;
        getPool[token1][token0][fee] = pool;
        allPools.push(pool);
        emit PoolCreated(token0, token1, fee, tickSpacing, pool);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    function setOwner(address _owner) external onlyOwner {
        require(_owner != address(0), "ZenithV3Factory: ZERO_ADDRESS");
        emit OwnerChanged(owner, _owner);
        owner = _owner;
    }
}
