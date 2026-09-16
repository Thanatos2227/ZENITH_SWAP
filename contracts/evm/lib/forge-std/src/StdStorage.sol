pragma solidity >=0.8.13 <0.9.0;

import {Vm} from "./Vm.sol";

struct FindData {
    uint256 slot;
    uint256 offsetLeft;
    uint256 offsetRight;
    bool found;
}

struct StdStorage {
    mapping(address => mapping(bytes4 => mapping(bytes32 => FindData))) finds;
    bytes32[] _keys;
    bytes4 _sig;
    uint256 _depth;
    address _target;
    bytes32 _set;
    bool _enable_packed_slots;
    bytes _calldata;
}

library stdStorageSafe {
    struct FindCallData {
        bytes32 result;
        bytes32 shortBytesStorageValue;
        bytes32[] reads;
    }

    event SlotFound(address who, bytes4 fsig, bytes32 keysHash, uint256 slot);
    event WARNING_UninitedSlot(address who, uint256 slot);

    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant UINT256_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935;

    function sigs(string memory sigStr) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(sigStr)));
    }

    function getCallParams(StdStorage storage self) internal view returns (bytes memory) {
        if (self._calldata.length == 0) {
            return _flatten(self._keys);
        } else {
            return self._calldata;
        }
    }

    function callTargetRaw(StdStorage storage self) private view returns (bool, bytes memory) {
        bytes memory cd = abi.encodePacked(self._sig, getCallParams(self));
        (bool success, bytes memory rdat) = self._target.staticcall(cd);

        return (success, rdat);
    }

    function callTarget(StdStorage storage self) internal view returns (bool, bytes32) {
        (bool success, bytes memory rdat) = callTargetRaw(self);
        bytes32 result = _bytesToBytes32(rdat, 32 * self._depth);

        return (success, result);
    }

    function _parseShortBytesReturn(bytes memory rdat) private pure returns (bytes32) {
        if (rdat.length != 96 || uint256(_bytesToBytes32(rdat, 0)) != 32) {
            return bytes32(0);
        }

        uint256 length = uint256(_bytesToBytes32(rdat, 32));
        if (length == 0 || length > 31) {
            return bytes32(0);
        }

        bytes32 value = _bytesToBytes32(rdat, 64);
        if (uint256(value) << (length * 8) != 0) {
            return bytes32(0);
        }

        return value | bytes32(length * 2);
    }

    function _matchesShortBytes(bytes32 slotValue, bytes32 expected) private pure returns (bool) {
        uint256 length = uint8(uint256(expected)) / 2;
        uint256 mask = (type(uint256).max << ((32 - length) * 8)) | 0xFF;
        return uint256(slotValue) & mask == uint256(expected);
    }

    function _checkShortBytesSlot(StdStorage storage self, bytes32 slot) private returns (bool) {
        bytes32 prevSlotValue = vm.load(self._target, slot);
        vm.store(self._target, slot, bytes32(0));
        (bool success, bytes memory rdat) = callTargetRaw(self);
        vm.store(self._target, slot, prevSlotValue);

        return success && rdat.length == 64 && uint256(_bytesToBytes32(rdat, 0)) == 32
            && uint256(_bytesToBytes32(rdat, 32)) == 0;
    }

    function checkSlotMutatesCall(StdStorage storage self, bytes32 slot) internal returns (bool) {
        bytes32 prevSlotValue = vm.load(self._target, slot);
        (bool success, bytes32 prevReturnValue) = callTarget(self);

        bytes32 testVal = prevReturnValue == bytes32(0) ? bytes32(UINT256_MAX) : bytes32(0);
        vm.store(self._target, slot, testVal);

        (, bytes32 newReturnValue) = callTarget(self);

        vm.store(self._target, slot, prevSlotValue);

        return (success && (prevReturnValue != newReturnValue));
    }

    function findOffset(StdStorage storage self, bytes32 slot, bool left) internal returns (bool, uint256) {
        for (uint256 offset = 0; offset < 256; offset++) {
            uint256 valueToPut = left ? (1 << (255 - offset)) : (1 << offset);
            vm.store(self._target, slot, bytes32(valueToPut));

            (bool success, bytes32 data) = callTarget(self);

            if (success && (uint256(data) > 0)) {
                return (true, offset);
            }
        }
        return (false, 0);
    }

    function findOffsets(StdStorage storage self, bytes32 slot) internal returns (bool, uint256, uint256) {
        bytes32 prevSlotValue = vm.load(self._target, slot);

        (bool foundLeft, uint256 offsetLeft) = findOffset(self, slot, true);
        (bool foundRight, uint256 offsetRight) = findOffset(self, slot, false);

        vm.store(self._target, slot, prevSlotValue);
        return (foundLeft && foundRight, offsetLeft, offsetRight);
    }

    function find(StdStorage storage self) internal returns (FindData storage) {
        return find(self, true);
    }

    function find(StdStorage storage self, bool _clear) internal returns (FindData storage) {
        address who = self._target;
        bytes4 fsig = self._sig;
        uint256 field_depth = self._depth;
        bytes memory params = getCallParams(self);

        if (self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))].found) {
            if (_clear) {
                clear(self);
            }
            return self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))];
        }
        FindCallData memory callData;
        {
            vm.record();
            (bool callSuccess, bytes memory rdat) = callTargetRaw(self);
            callData.result = _bytesToBytes32(rdat, 32 * field_depth);
            if (callSuccess && field_depth == 0) {
                callData.shortBytesStorageValue = _parseShortBytesReturn(rdat);
            }
            (callData.reads,) = vm.accesses(address(who));
            vm.stopRecord();
        }

        if (callData.reads.length == 0) {
            revert("stdStorage find(StdStorage): No storage use detected for target.");
        } else {
            for (uint256 i = callData.reads.length; i > 0;) {
                --i;
                bytes32 slot = callData.reads[i];
                bytes32 prev = vm.load(who, slot);
                if (prev == bytes32(0)) {
                    emit WARNING_UninitedSlot(who, uint256(slot));
                }

                bool shortBytesFound = callData.shortBytesStorageValue != bytes32(0)
                    && _matchesShortBytes(prev, callData.shortBytesStorageValue) && _checkShortBytesSlot(self, slot);

                if (!shortBytesFound && !checkSlotMutatesCall(self, slot)) {
                    continue;
                }

                (uint256 offsetLeft, uint256 offsetRight) = (0, 0);

                if (!shortBytesFound && self._enable_packed_slots) {
                    bool found;
                    (found, offsetLeft, offsetRight) = findOffsets(self, slot);
                    if (!found) {
                        continue;
                    }
                }

                uint256 curVal = (uint256(prev) & getMaskByOffsets(offsetLeft, offsetRight)) >> offsetRight;

                if (
                    !shortBytesFound
                        && (uint256(callData.result) & (getMaskByOffsets(offsetLeft, offsetRight) >> offsetRight))
                            != curVal
                ) {
                    continue;
                }

                emit SlotFound(who, fsig, keccak256(abi.encodePacked(params, field_depth)), uint256(slot));
                self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))] =
                    FindData(uint256(slot), offsetLeft, offsetRight, true);
                break;
            }
        }

        require(
            self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))].found,
            "stdStorage find(StdStorage): Slot(s) not found."
        );

        if (_clear) {
            clear(self);
        }
        return self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))];
    }

    function target(StdStorage storage self, address _target) internal returns (StdStorage storage) {
        self._target = _target;
        return self;
    }

    function sig(StdStorage storage self, bytes4 _sig) internal returns (StdStorage storage) {
        self._sig = _sig;
        return self;
    }

    function sig(StdStorage storage self, string memory _sig) internal returns (StdStorage storage) {
        self._sig = sigs(_sig);
        return self;
    }

    function with_calldata(StdStorage storage self, bytes memory _calldata) internal returns (StdStorage storage) {
        self._calldata = _calldata;
        return self;
    }

    function with_key(StdStorage storage self, address who) internal returns (StdStorage storage) {
        self._keys.push(bytes32(uint256(uint160(who))));
        return self;
    }

    function with_key(StdStorage storage self, uint256 amt) internal returns (StdStorage storage) {
        self._keys.push(bytes32(amt));
        return self;
    }

    function with_key(StdStorage storage self, bytes32 key) internal returns (StdStorage storage) {
        self._keys.push(key);
        return self;
    }

    function enable_packed_slots(StdStorage storage self) internal returns (StdStorage storage) {
        self._enable_packed_slots = true;
        return self;
    }

    function depth(StdStorage storage self, uint256 _depth) internal returns (StdStorage storage) {
        self._depth = _depth;
        return self;
    }

    function _read(StdStorage storage self) private returns (bytes memory) {
        FindData storage data = find(self, false);
        uint256 mask = getMaskByOffsets(data.offsetLeft, data.offsetRight);
        uint256 value = (uint256(vm.load(self._target, bytes32(data.slot))) & mask) >> data.offsetRight;
        clear(self);
        return abi.encode(value);
    }

    function read_bytes32(StdStorage storage self) internal returns (bytes32) {
        return abi.decode(_read(self), (bytes32));
    }

    function read_bool(StdStorage storage self) internal returns (bool) {
        int256 v = read_int(self);
        if (v == 0) return false;
        if (v == 1) return true;
        revert("stdStorage read_bool(StdStorage): Cannot decode. Make sure you are reading a bool.");
    }

    function read_address(StdStorage storage self) internal returns (address) {
        return abi.decode(_read(self), (address));
    }

    function read_uint(StdStorage storage self) internal returns (uint256) {
        return abi.decode(_read(self), (uint256));
    }

    function read_int(StdStorage storage self) internal returns (int256) {
        FindData storage data = find(self, false);
        uint256 offsetLeft = data.offsetLeft;
        uint256 offsetRight = data.offsetRight;
        uint256 value = (uint256(vm.load(self._target, bytes32(data.slot))) & getMaskByOffsets(offsetLeft, offsetRight))
            >> offsetRight;
        clear(self);

        uint256 shift = offsetLeft + offsetRight;
        if (shift == 0) return int256(value);
        return (int256(value) << shift) >> shift;
    }

    function parent(StdStorage storage self) internal returns (uint256, bytes32) {
        address who = self._target;
        uint256 field_depth = self._depth;
        vm.startMappingRecording();
        uint256 child = find(self, true).slot - field_depth;
        (bool found, bytes32 key, bytes32 parent_slot) = vm.getMappingKeyAndParentOf(who, bytes32(child));
        if (!found) {
            revert(
                "stdStorage parent(StdStorage): Cannot find parent. Make sure you give a slot and startMappingRecording() has been called."
            );
        }
        return (uint256(parent_slot), key);
    }

    function root(StdStorage storage self) internal returns (uint256) {
        address who = self._target;
        uint256 field_depth = self._depth;
        vm.startMappingRecording();
        uint256 child = find(self, true).slot - field_depth;
        bool found;
        bytes32 root_slot;
        bytes32 parent_slot;
        (found,, parent_slot) = vm.getMappingKeyAndParentOf(who, bytes32(child));
        if (!found) {
            revert(
                "stdStorage root(StdStorage): Cannot find parent. Make sure you give a slot and startMappingRecording() has been called."
            );
        }
        while (found) {
            root_slot = parent_slot;
            (found,, parent_slot) = vm.getMappingKeyAndParentOf(who, bytes32(root_slot));
        }
        return uint256(root_slot);
    }

    function _bytesToBytes32(bytes memory b, uint256 offset) private pure returns (bytes32) {
        bytes32 out;

        uint256 max = b.length > offset ? b.length - offset : 0;
        if (max > 32) {
            max = 32;
        }
        for (uint256 i = 0; i < max; i++) {
            out |= bytes32(b[offset + i] & 0xFF) >> (i * 8);
        }
        return out;
    }

    function _flatten(bytes32[] memory b) private pure returns (bytes memory) {
        bytes memory result = new bytes(b.length * 32);
        for (uint256 i = 0; i < b.length; i++) {
            bytes32 k = b[i];
            assembly ("memory-safe") {
                mstore(add(result, add(32, mul(32, i))), k)
            }
        }

        return result;
    }

    function clear(StdStorage storage self) internal {
        delete self._target;
        delete self._sig;
        delete self._keys;
        delete self._depth;
        delete self._enable_packed_slots;
        delete self._calldata;
    }

    function getMaskByOffsets(uint256 offsetLeft, uint256 offsetRight) internal pure returns (uint256 mask) {

        assembly {
            mask := shl(offsetRight, sub(shl(sub(256, add(offsetRight, offsetLeft)), 1), 1))
        }
    }

    function getUpdatedSlotValue(bytes32 curValue, uint256 varValue, uint256 offsetLeft, uint256 offsetRight)
        internal
        pure
        returns (bytes32 newValue)
    {
        return bytes32((uint256(curValue) & ~getMaskByOffsets(offsetLeft, offsetRight)) | (varValue << offsetRight));
    }
}

library stdStorage {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function sigs(string memory sigStr) internal pure returns (bytes4) {
        return stdStorageSafe.sigs(sigStr);
    }

    function find(StdStorage storage self) internal returns (uint256) {
        return find(self, true);
    }

    function find(StdStorage storage self, bool _clear) internal returns (uint256) {
        return stdStorageSafe.find(self, _clear).slot;
    }

    function target(StdStorage storage self, address _target) internal returns (StdStorage storage) {
        return stdStorageSafe.target(self, _target);
    }

    function sig(StdStorage storage self, bytes4 _sig) internal returns (StdStorage storage) {
        return stdStorageSafe.sig(self, _sig);
    }

    function sig(StdStorage storage self, string memory _sig) internal returns (StdStorage storage) {
        return stdStorageSafe.sig(self, _sig);
    }

    function with_key(StdStorage storage self, address who) internal returns (StdStorage storage) {
        return stdStorageSafe.with_key(self, who);
    }

    function with_key(StdStorage storage self, uint256 amt) internal returns (StdStorage storage) {
        return stdStorageSafe.with_key(self, amt);
    }

    function with_key(StdStorage storage self, bytes32 key) internal returns (StdStorage storage) {
        return stdStorageSafe.with_key(self, key);
    }

    function with_calldata(StdStorage storage self, bytes memory _calldata) internal returns (StdStorage storage) {
        return stdStorageSafe.with_calldata(self, _calldata);
    }

    function enable_packed_slots(StdStorage storage self) internal returns (StdStorage storage) {
        return stdStorageSafe.enable_packed_slots(self);
    }

    function depth(StdStorage storage self, uint256 _depth) internal returns (StdStorage storage) {
        return stdStorageSafe.depth(self, _depth);
    }

    function clear(StdStorage storage self) internal {
        stdStorageSafe.clear(self);
    }

    function checked_write(StdStorage storage self, address who) internal {
        checked_write(self, bytes32(uint256(uint160(who))));
    }

    function checked_write(StdStorage storage self, uint256 amt) internal {
        checked_write(self, bytes32(amt));
    }

    function checked_write_int(StdStorage storage self, int256 val) internal {
        checked_write(self, bytes32(uint256(val)));
    }

    function checked_write(StdStorage storage self, bool write) internal {
        bytes32 t;
        assembly ("memory-safe") {
            t := write
        }
        checked_write(self, t);
    }

    function checked_write(StdStorage storage self, bytes32 set) internal {
        address who = self._target;
        bytes4 fsig = self._sig;
        uint256 field_depth = self._depth;
        bytes memory params = stdStorageSafe.getCallParams(self);

        if (!self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))].found) {
            find(self, false);
        }
        FindData storage data = self.finds[who][fsig][keccak256(abi.encodePacked(params, field_depth))];
        uint256 valueToStore = uint256(set);
        if ((data.offsetLeft + data.offsetRight) > 0) {
            uint256 width = 256 - (data.offsetLeft + data.offsetRight);
            uint256 maxVal = 2 ** width;

            if (valueToStore >= maxVal && (int256(valueToStore) >> (width - 1)) == -1) {
                valueToStore &= maxVal - 1;
            }
            require(
                valueToStore < maxVal,
                string(
                    abi.encodePacked(
                        "stdStorage checked_write(StdStorage): Packed slot. We can't fit value greater than ",
                        vm.toString(maxVal)
                    )
                )
            );
        }
        bytes32 curVal = vm.load(who, bytes32(data.slot));
        bytes32 valToSet = stdStorageSafe.getUpdatedSlotValue(curVal, valueToStore, data.offsetLeft, data.offsetRight);

        vm.store(who, bytes32(data.slot), valToSet);

        (bool success, bytes32 callResult) = stdStorageSafe.callTarget(self);

        if (!success || callResult != set) {
            vm.store(who, bytes32(data.slot), curVal);
            revert("stdStorage checked_write(StdStorage): Failed to write value.");
        }
        clear(self);
    }

    function read_bytes32(StdStorage storage self) internal returns (bytes32) {
        return stdStorageSafe.read_bytes32(self);
    }

    function read_bool(StdStorage storage self) internal returns (bool) {
        return stdStorageSafe.read_bool(self);
    }

    function read_address(StdStorage storage self) internal returns (address) {
        return stdStorageSafe.read_address(self);
    }

    function read_uint(StdStorage storage self) internal returns (uint256) {
        return stdStorageSafe.read_uint(self);
    }

    function read_int(StdStorage storage self) internal returns (int256) {
        return stdStorageSafe.read_int(self);
    }

    function parent(StdStorage storage self) internal returns (uint256, bytes32) {
        return stdStorageSafe.parent(self);
    }

    function root(StdStorage storage self) internal returns (uint256) {
        return stdStorageSafe.root(self);
    }
}
