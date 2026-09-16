pragma solidity ^0.8.13;

import {VmSafe} from "./Vm.sol";
import {Variable, Type, TypeKind, LibVariable} from "./LibVariable.sol";

contract StdConfig {
    using LibVariable for Type;
    using LibVariable for TypeKind;

    VmSafe private constant vm = VmSafe(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint8 private constant _NUM_TYPES = 7;

    error AlreadyInitialized(string key);
    error InvalidChainKey(string aliasOrId);
    error ChainNotInitialized(uint256 chainId);
    error UnableToParseVariable(string key);
    error WriteToFileInForbiddenCtxt();
    error MissingRpcEndpoint(uint256 chainId);

    string private _filePath;

    string[] private _chainKeys;

    mapping(uint256 => string) private _rpcOf;

    mapping(uint256 => mapping(string => bytes)) private _dataOf;

    mapping(uint256 => mapping(string => Type)) private _typeOf;

    bool private _writeToFile;

    constructor(string memory configFilePath, bool writeToFile) {
        if (writeToFile && !vm.isContext(VmSafe.ForgeContext.ScriptGroup)) {
            revert WriteToFileInForbiddenCtxt();
        }

        _filePath = configFilePath;
        _writeToFile = writeToFile;
        string memory content = vm.resolveEnv(vm.readFile(configFilePath));
        string[] memory chain_keys = vm.parseTomlKeys(content, "$");

        for (uint256 i = 0; i < chain_keys.length; i++) {
            string memory chain_key = chain_keys[i];

            if (vm.parseTomlKeys(content, string.concat("$.", chain_key)).length == 0) {
                continue;
            }
            uint256 chainId = resolveChainId(chain_key);
            _chainKeys.push(chain_key);

            try vm.parseTomlString(content, string.concat("$.", chain_key, ".endpoint_url")) returns (
                string memory url
            ) {
                _rpcOf[chainId] = vm.resolveEnv(url);
            } catch {
                try vm.rpcUrl(chain_key) returns (string memory url) {
                    _rpcOf[chainId] = vm.resolveEnv(url);
                } catch {}
            }

            for (uint8 t = 1; t <= _NUM_TYPES; t++) {
                TypeKind ty = TypeKind(t);
                string memory typePath = string.concat("$.", chain_key, ".", ty.toTomlKey());

                try vm.parseTomlKeys(content, typePath) returns (string[] memory keys) {
                    for (uint256 j = 0; j < keys.length; j++) {
                        string memory key = keys[j];
                        if (_typeOf[chainId][key].kind == TypeKind.None) {
                            _loadAndCacheValue(content, string.concat(typePath, ".", key), chainId, key, ty);
                        } else {
                            revert AlreadyInitialized(key);
                        }
                    }
                } catch {}
            }
        }
    }

    function _loadAndCacheValue(
        string memory content,
        string memory path,
        uint256 chainId,
        string memory key,
        TypeKind ty
    ) private {
        bool success = false;
        if (ty == TypeKind.Bool) {
            try vm.parseTomlBool(content, path) returns (bool val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Bool, false);
                success = true;
            } catch {
                try vm.parseTomlBoolArray(content, path) returns (bool[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Bool, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.Address) {
            try vm.parseTomlAddress(content, path) returns (address val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Address, false);
                success = true;
            } catch {
                try vm.parseTomlAddressArray(content, path) returns (address[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Address, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.Bytes32) {
            try vm.parseTomlBytes32(content, path) returns (bytes32 val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Bytes32, false);
                success = true;
            } catch {
                try vm.parseTomlBytes32Array(content, path) returns (bytes32[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Bytes32, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.Uint256) {
            try vm.parseTomlUint(content, path) returns (uint256 val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Uint256, false);
                success = true;
            } catch {
                try vm.parseTomlUintArray(content, path) returns (uint256[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Uint256, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.Int256) {
            try vm.parseTomlInt(content, path) returns (int256 val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Int256, false);
                success = true;
            } catch {
                try vm.parseTomlIntArray(content, path) returns (int256[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Int256, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.Bytes) {
            try vm.parseTomlBytes(content, path) returns (bytes memory val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.Bytes, false);
                success = true;
            } catch {
                try vm.parseTomlBytesArray(content, path) returns (bytes[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.Bytes, true);
                    success = true;
                } catch {}
            }
        } else if (ty == TypeKind.String) {
            try vm.parseTomlString(content, path) returns (string memory val) {
                _dataOf[chainId][key] = abi.encode(val);
                _typeOf[chainId][key] = Type(TypeKind.String, false);
                success = true;
            } catch {
                try vm.parseTomlStringArray(content, path) returns (string[] memory val) {
                    _dataOf[chainId][key] = abi.encode(val);
                    _typeOf[chainId][key] = Type(TypeKind.String, true);
                    success = true;
                } catch {}
            }
        }

        if (!success) {
            revert UnableToParseVariable(key);
        }
    }

    function writeUpdatesBackToFile(bool enabled) public {
        if (enabled && !vm.isContext(VmSafe.ForgeContext.ScriptGroup)) {
            revert WriteToFileInForbiddenCtxt();
        }

        _writeToFile = enabled;
    }

    function resolveChainId(string memory aliasOrId) public view returns (uint256) {
        try vm.parseUint(aliasOrId) returns (uint256 chainId) {
            return chainId;
        } catch {
            try vm.getChain(aliasOrId) returns (VmSafe.Chain memory chainInfo) {
                return chainInfo.chainId;
            } catch {
                revert InvalidChainKey(aliasOrId);
            }
        }
    }

    function _getChainKeyFromId(uint256 chainId) private view returns (string memory) {
        for (uint256 i = 0; i < _chainKeys.length; i++) {
            if (resolveChainId(_chainKeys[i]) == chainId) {
                return _chainKeys[i];
            }
        }
        revert ChainNotInitialized(chainId);
    }

    function _ensureTypeConsistency(uint256 chainId, string memory key, Type memory ty) private {
        Type memory current = _typeOf[chainId][key];

        if (current.kind == TypeKind.None) {
            _typeOf[chainId][key] = ty;
        } else {
            current.assertEq(ty);
        }
    }

    function _quote(string memory s) private pure returns (string memory) {
        return string.concat('"', s, '"');
    }

    function _writeToToml(uint256 chainId, string memory ty, string memory key, string memory jsonValue) private {
        string memory chainKey = _getChainKeyFromId(chainId);
        string memory valueKey = string.concat("$.", chainKey, ".", ty, ".", key);
        vm.writeToml(jsonValue, _filePath, valueKey);
    }

    function get(uint256 chain_id, string memory key) public view returns (Variable memory) {
        return Variable(_typeOf[chain_id][key], _dataOf[chain_id][key]);
    }

    function get(string memory key) public view returns (Variable memory) {
        return get(vm.getChainId(), key);
    }

    function exists(uint256 chain_id, string memory key) public view returns (bool) {
        return _dataOf[chain_id][key].length > 0;
    }

    function exists(string memory key) public view returns (bool) {
        return exists(vm.getChainId(), key);
    }

    function getChainIds() public view returns (uint256[] memory) {
        string[] memory keys = _chainKeys;

        uint256[] memory ids = new uint256[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            ids[i] = resolveChainId(keys[i]);
        }

        return ids;
    }

    function getRpcUrl(uint256 chainId) public view returns (string memory) {
        string memory url = _rpcOf[chainId];
        if (bytes(url).length == 0) revert MissingRpcEndpoint(chainId);
        return url;
    }

    function getRpcUrl() public view returns (string memory) {
        return getRpcUrl(vm.getChainId());
    }

    function set(uint256 chainId, string memory key, bool value) public {
        Type memory ty = Type(TypeKind.Bool, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, vm.toString(value));
    }

    function set(string memory key, bool value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, address value) public {
        Type memory ty = Type(TypeKind.Address, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, _quote(vm.toString(value)));
    }

    function set(string memory key, address value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, bytes32 value) public {
        Type memory ty = Type(TypeKind.Bytes32, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, _quote(vm.toString(value)));
    }

    function set(string memory key, bytes32 value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, uint256 value) public {
        Type memory ty = Type(TypeKind.Uint256, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, vm.toString(value));
    }

    function set(string memory key, uint256 value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, int256 value) public {
        Type memory ty = Type(TypeKind.Int256, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, vm.toString(value));
    }

    function set(string memory key, int256 value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, string memory value) public {
        Type memory ty = Type(TypeKind.String, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, _quote(value));
    }

    function set(string memory key, string memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, bytes memory value) public {
        Type memory ty = Type(TypeKind.Bytes, false);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) _writeToToml(chainId, ty.kind.toTomlKey(), key, _quote(vm.toString(value)));
    }

    function set(string memory key, bytes memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, bool[] memory value) public {
        Type memory ty = Type(TypeKind.Bool, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, vm.toString(value[i]));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, bool[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, address[] memory value) public {
        Type memory ty = Type(TypeKind.Address, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, _quote(vm.toString(value[i])));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, address[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, bytes32[] memory value) public {
        Type memory ty = Type(TypeKind.Bytes32, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, _quote(vm.toString(value[i])));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, bytes32[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, uint256[] memory value) public {
        Type memory ty = Type(TypeKind.Uint256, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, vm.toString(value[i]));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, uint256[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, int256[] memory value) public {
        Type memory ty = Type(TypeKind.Int256, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, vm.toString(value[i]));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, int256[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, string[] memory value) public {
        Type memory ty = Type(TypeKind.String, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, _quote(value[i]));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, string[] memory value) public {
        set(vm.getChainId(), key, value);
    }

    function set(uint256 chainId, string memory key, bytes[] memory value) public {
        Type memory ty = Type(TypeKind.Bytes, true);
        _ensureTypeConsistency(chainId, key, ty);
        _dataOf[chainId][key] = abi.encode(value);
        if (_writeToFile) {
            string memory json = "[";
            for (uint256 i = 0; i < value.length; i++) {
                json = string.concat(json, _quote(vm.toString(value[i])));
                if (i < value.length - 1) json = string.concat(json, ",");
            }
            json = string.concat(json, "]");
            _writeToToml(chainId, ty.kind.toTomlKey(), key, json);
        }
    }

    function set(string memory key, bytes[] memory value) public {
        set(vm.getChainId(), key, value);
    }
}
