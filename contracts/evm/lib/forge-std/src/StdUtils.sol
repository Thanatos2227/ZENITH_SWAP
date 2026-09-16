pragma solidity >=0.8.13 <0.9.0;

import {IMulticall3} from "./interfaces/IMulticall3.sol";
import {StdConstants} from "./StdConstants.sol";
import {VmSafe} from "./Vm.sol";

abstract contract StdUtils {

    VmSafe private constant vm = VmSafe(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant _CONSOLE2_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;
    uint256 private constant _INT256_MIN_ABS =
        57896044618658097711785492504343953926634992332820282019728792003956564819968;
    uint256 private constant _SECP256K1_ORDER =
        115792089237316195423570985008687907852837564279074904382605163141518161494337;
    uint256 private constant _UINT256_MAX =
        115792089237316195423570985008687907853269984665640564039457584007913129639935;

    function _bound(uint256 x, uint256 min, uint256 max) internal pure virtual returns (uint256 result) {
        require(min <= max, "StdUtils bound(uint256,uint256,uint256): Max is less than min.");

        if (x >= min && x <= max) return x;

        uint256 size = max - min + 1;

        if (x <= 3 && size > x) return min + x;
        if (x >= _UINT256_MAX - 3 && size > _UINT256_MAX - x) return max - (_UINT256_MAX - x);

        if (x > max) {
            uint256 diff = x - max;
            uint256 rem = diff % size;
            if (rem == 0) return max;
            result = min + rem - 1;
        } else if (x < min) {
            uint256 diff = min - x;
            uint256 rem = diff % size;
            if (rem == 0) return min;
            result = max - rem + 1;
        }
    }

    function bound(uint256 x, uint256 min, uint256 max) internal pure virtual returns (uint256 result) {
        result = _bound(x, min, max);
    }

    function _bound(int256 x, int256 min, int256 max) internal pure virtual returns (int256 result) {
        require(min <= max, "StdUtils bound(int256,int256,int256): Max is less than min.");

        uint256 _x = x < 0 ? (_INT256_MIN_ABS - ~uint256(x) - 1) : (uint256(x) + _INT256_MIN_ABS);
        uint256 _min = min < 0 ? (_INT256_MIN_ABS - ~uint256(min) - 1) : (uint256(min) + _INT256_MIN_ABS);
        uint256 _max = max < 0 ? (_INT256_MIN_ABS - ~uint256(max) - 1) : (uint256(max) + _INT256_MIN_ABS);

        uint256 y = _bound(_x, _min, _max);

        result = y < _INT256_MIN_ABS ? int256(~(_INT256_MIN_ABS - y) + 1) : int256(y - _INT256_MIN_ABS);
    }

    function bound(int256 x, int256 min, int256 max) internal pure virtual returns (int256 result) {
        result = _bound(x, min, max);
    }

    function boundPrivateKey(uint256 privateKey) internal pure virtual returns (uint256 result) {
        result = _bound(privateKey, 1, _SECP256K1_ORDER - 1);
    }

    function bytesToUint(bytes memory b) internal pure virtual returns (uint256) {
        require(b.length <= 32, "StdUtils bytesToUint(bytes): Bytes length exceeds 32.");
        return abi.decode(abi.encodePacked(new bytes(32 - b.length), b), (uint256));
    }

    function computeCreateAddress(address deployer, uint256 nonce) internal pure virtual returns (address) {
        _console2_log_StdUtils("computeCreateAddress is deprecated. Please use vm.computeCreateAddress instead.");
        return vm.computeCreateAddress(deployer, nonce);
    }

    function computeCreate2Address(bytes32 salt, bytes32 initcodeHash, address deployer)
        internal
        pure
        virtual
        returns (address)
    {
        _console2_log_StdUtils("computeCreate2Address is deprecated. Please use vm.computeCreate2Address instead.");
        return vm.computeCreate2Address(salt, initcodeHash, deployer);
    }

    function computeCreate2Address(bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        _console2_log_StdUtils("computeCreate2Address is deprecated. Please use vm.computeCreate2Address instead.");
        return vm.computeCreate2Address(salt, initCodeHash);
    }

    function hashInitCode(bytes memory creationCode) internal pure returns (bytes32) {
        return hashInitCode(creationCode, "");
    }

    function hashInitCode(bytes memory creationCode, bytes memory args) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(creationCode, args));
    }

    function getTokenBalances(address token, address[] memory addresses)
        internal
        virtual
        returns (uint256[] memory balances)
    {
        uint256 tokenCodeSize;
        assembly {
            tokenCodeSize := extcodesize(token)
        }
        require(tokenCodeSize > 0, "StdUtils getTokenBalances(address,address[]): Token address is not a contract.");

        uint256 length = addresses.length;
        IMulticall3.Call[] memory calls = new IMulticall3.Call[](length);
        for (uint256 i = 0; i < length; ++i) {

            calls[i] = IMulticall3.Call({target: token, callData: abi.encodeWithSelector(0x70a08231, (addresses[i]))});
        }

        (, bytes[] memory returnData) = StdConstants.MULTICALL3_ADDRESS.aggregate(calls);

        balances = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            balances[i] = abi.decode(returnData[i], (uint256));
        }
    }

    function _addressFromLast20Bytes(bytes32 bytesValue) private pure returns (address) {
        return address(uint160(uint256(bytesValue)));
    }

    function _castLogPayloadViewToPure(function(bytes memory) internal view fnIn)
        internal
        pure
        returns (function(bytes memory) internal pure fnOut)
    {
        assembly {
            fnOut := fnIn
        }
    }

    function _sendLogPayload(bytes memory payload) internal pure {
        _castLogPayloadViewToPure(_sendLogPayloadView)(payload);
    }

    function _sendLogPayloadView(bytes memory payload) private view {
        uint256 payloadLength = payload.length;
        address consoleAddress = _CONSOLE2_ADDRESS;
        assembly ("memory-safe") {
            let payloadStart := add(payload, 32)
            let r := staticcall(gas(), consoleAddress, payloadStart, payloadLength, 0, 0)
        }
    }

    function _console2_log_StdUtils(string memory p0) private pure {
        _sendLogPayload(abi.encodeWithSignature("log(string)", p0));
    }

    function _console2_log_StdUtils(string memory p0, uint256 p1) private pure {
        _sendLogPayload(abi.encodeWithSignature("log(string,uint256)", p0, p1));
    }

    function _console2_log_StdUtils(string memory p0, string memory p1) private pure {
        _sendLogPayload(abi.encodeWithSignature("log(string,string)", p0, p1));
    }
}
