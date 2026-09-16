pragma solidity 0.8.24;

import "../interfaces/IZenithHook.sol";

contract DynamicFeeHook is IZenithHook {
    address public immutable owner;
    uint24 public baseFeeBps;
    uint24 public maxFeeBps;

    mapping(bytes32 => uint256) public lastBlockNumber;
    mapping(bytes32 => uint256) public blockVolume;

    event FeeUpdated(uint24 newBaseFee, uint24 newMaxFee);
    event DynamicFeeApplied(bytes32 indexed poolId, address indexed sender, uint24 dynamicFeeBps, uint256 currentBlockVolume);

    modifier onlyOwner() {
        require(msg.sender == owner, "DynamicFeeHook: NOT_OWNER");
        _;
    }

    constructor(uint24 _baseFeeBps, uint24 _maxFeeBps) {
        owner = msg.sender;
        baseFeeBps = _baseFeeBps;
        maxFeeBps = _maxFeeBps;
    }

    function getPermissions() external pure override returns (HookPermissions memory) {
        return HookPermissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true
        });
    }

    function beforeInitialize(address, bytes32, uint160, bytes calldata) external pure override returns (bytes4) {
        return this.beforeInitialize.selector;
    }

    function afterInitialize(address, bytes32, uint160, int24, bytes calldata) external pure override returns (bytes4) {
        return this.afterInitialize.selector;
    }

    function beforeAddLiquidity(address, bytes32, int24, int24, uint128, bytes calldata) external pure override returns (bytes4) {
        return this.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(address, bytes32, int24, int24, uint128, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.afterAddLiquidity.selector;
    }

    function beforeSwap(
        address sender,
        bytes32 poolId,
        bool,
        int256 amountSpecified,
        uint160,
        bytes calldata
    ) external override returns (bytes4, uint24 dynamicFeeBps) {
        uint256 currentBlock = block.number;
        if (lastBlockNumber[poolId] != currentBlock) {
            lastBlockNumber[poolId] = currentBlock;
            blockVolume[poolId] = 0;
        }

        uint256 absAmount = amountSpecified < 0 ? uint256(-amountSpecified) : uint256(amountSpecified);
        blockVolume[poolId] += absAmount;

        if (blockVolume[poolId] > 100 ether) {
            dynamicFeeBps = maxFeeBps;
        } else {
            dynamicFeeBps = baseFeeBps;
        }

        emit DynamicFeeApplied(poolId, sender, dynamicFeeBps, blockVolume[poolId]);

        return (this.beforeSwap.selector, dynamicFeeBps);
    }

    function afterSwap(
        address,
        bytes32,
        bool,
        int256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.afterSwap.selector;
    }

    function setFeeParameters(uint24 _baseFeeBps, uint24 _maxFeeBps) external onlyOwner {
        require(_baseFeeBps <= _maxFeeBps, "DynamicFeeHook: INVALID_RANGE");
        baseFeeBps = _baseFeeBps;
        maxFeeBps = _maxFeeBps;
        emit FeeUpdated(_baseFeeBps, _maxFeeBps);
    }
}
