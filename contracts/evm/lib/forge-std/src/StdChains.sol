pragma solidity >=0.8.13 <0.9.0;

import {VmSafe} from "./Vm.sol";

abstract contract StdChains {
    VmSafe private constant vm = VmSafe(address(uint160(uint256(keccak256("hevm cheat code")))));

    bool private _stdChainsInitialized;

    struct ChainData {
        string name;
        uint256 chainId;
        string rpcUrl;
    }

    struct Chain {

        string name;

        uint256 chainId;

        string chainAlias;

        string rpcUrl;
    }

    mapping(string => Chain) private _chains;

    mapping(string => string) private _defaultRpcUrls;

    mapping(uint256 => string) private _idToAlias;

    bool private _fallbackToDefaultRpcUrls = true;

    function getChain(string memory chainAlias) internal virtual returns (Chain memory chain) {
        require(bytes(chainAlias).length != 0, "StdChains getChain(string): Chain alias cannot be the empty string.");

        _initializeStdChains();
        chain = _chains[chainAlias];
        require(
            chain.chainId != 0,
            string(abi.encodePacked("StdChains getChain(string): Chain with alias \"", chainAlias, "\" not found."))
        );

        chain = _getChainWithUpdatedRpcUrl(chainAlias, chain);
    }

    function getChain(uint256 chainId) internal virtual returns (Chain memory chain) {
        require(chainId != 0, "StdChains getChain(uint256): Chain ID cannot be 0.");
        _initializeStdChains();
        string memory chainAlias = _idToAlias[chainId];

        chain = _chains[chainAlias];

        require(
            chain.chainId != 0,
            string(abi.encodePacked("StdChains getChain(uint256): Chain with ID ", vm.toString(chainId), " not found."))
        );

        chain = _getChainWithUpdatedRpcUrl(chainAlias, chain);
    }

    function setChain(string memory chainAlias, ChainData memory chain) internal virtual {
        require(
            bytes(chainAlias).length != 0,
            "StdChains setChain(string,ChainData): Chain alias cannot be the empty string."
        );

        require(chain.chainId != 0, "StdChains setChain(string,ChainData): Chain ID cannot be 0.");

        _initializeStdChains();
        string memory foundAlias = _idToAlias[chain.chainId];

        require(
            bytes(foundAlias).length == 0 || keccak256(bytes(foundAlias)) == keccak256(bytes(chainAlias)),
            string(
                abi.encodePacked(
                    "StdChains setChain(string,ChainData): Chain ID ",
                    vm.toString(chain.chainId),
                    " already used by \"",
                    foundAlias,
                    "\"."
                )
            )
        );

        uint256 oldChainId = _chains[chainAlias].chainId;
        delete _idToAlias[oldChainId];

        _chains[chainAlias] =
            Chain({name: chain.name, chainId: chain.chainId, chainAlias: chainAlias, rpcUrl: chain.rpcUrl});
        _idToAlias[chain.chainId] = chainAlias;
    }

    function setChain(string memory chainAlias, Chain memory chain) internal virtual {
        setChain(chainAlias, ChainData({name: chain.name, chainId: chain.chainId, rpcUrl: chain.rpcUrl}));
    }

    function _toUpper(string memory str) private pure returns (string memory) {
        bytes memory strb = bytes(str);
        bytes memory copy = new bytes(strb.length);
        for (uint256 i = 0; i < strb.length; i++) {
            bytes1 b = strb[i];
            if (b >= 0x61 && b <= 0x7A) {
                copy[i] = bytes1(uint8(b) - 32);
            } else {
                copy[i] = b;
            }
        }
        return string(copy);
    }

    function _getChainWithUpdatedRpcUrl(string memory chainAlias, Chain memory chain)
        private
        view
        returns (Chain memory)
    {
        if (bytes(chain.rpcUrl).length == 0) {
            try vm.rpcUrl(chainAlias) returns (string memory configRpcUrl) {
                chain.rpcUrl = configRpcUrl;
            } catch (bytes memory err) {
                string memory envName = string(abi.encodePacked(_toUpper(chainAlias), "_RPC_URL"));
                if (_fallbackToDefaultRpcUrls) {
                    chain.rpcUrl = vm.envOr(envName, _defaultRpcUrls[chainAlias]);
                } else {
                    chain.rpcUrl = vm.envString(envName);
                }

                bytes memory oldNotFoundError =
                    abi.encodeWithSignature("CheatCodeError", string(abi.encodePacked("invalid rpc url ", chainAlias)));
                bytes memory newNotFoundError = abi.encodeWithSignature(
                    "CheatcodeError(string)", string(abi.encodePacked("invalid rpc url: ", chainAlias))
                );
                bytes32 errHash = keccak256(err);
                if (
                    (errHash != keccak256(oldNotFoundError) && errHash != keccak256(newNotFoundError))
                        || bytes(chain.rpcUrl).length == 0
                ) {
                    assembly ("memory-safe") {
                        revert(add(32, err), mload(err))
                    }
                }
            }
        }
        return chain;
    }

    function setFallbackToDefaultRpcUrls(bool useDefault) internal {
        _fallbackToDefaultRpcUrls = useDefault;
    }

    function _initializeStdChains() private {
        if (_stdChainsInitialized) return;

        _stdChainsInitialized = true;

        _setChainWithDefaultRpcUrl("anvil", ChainData("Anvil", 31337, "http://127.0.0.1:8545"));
        _setChainWithDefaultRpcUrl("mainnet", ChainData("Mainnet", 1, "https://eth.llamarpc.com"));
        _setChainWithDefaultRpcUrl(
            "sepolia", ChainData("Sepolia", 11155111, "https://sepolia.infura.io/v3/b9794ad1ddf84dfb8c34d6bb5dca2001")
        );
        _setChainWithDefaultRpcUrl("holesky", ChainData("Holesky", 17000, "https://rpc.holesky.ethpandaops.io"));
        _setChainWithDefaultRpcUrl("hoodi", ChainData("Hoodi", 560048, "https://rpc.hoodi.ethpandaops.io"));
        _setChainWithDefaultRpcUrl("optimism", ChainData("Optimism", 10, "https://mainnet.optimism.io"));
        _setChainWithDefaultRpcUrl(
            "optimism_sepolia", ChainData("Optimism Sepolia", 11155420, "https://sepolia.optimism.io")
        );
        _setChainWithDefaultRpcUrl("arbitrum_one", ChainData("Arbitrum One", 42161, "https://arb1.arbitrum.io/rpc"));
        _setChainWithDefaultRpcUrl(
            "arbitrum_one_sepolia", ChainData("Arbitrum One Sepolia", 421614, "https://sepolia-rollup.arbitrum.io/rpc")
        );
        _setChainWithDefaultRpcUrl("arbitrum_nova", ChainData("Arbitrum Nova", 42170, "https://nova.arbitrum.io/rpc"));
        _setChainWithDefaultRpcUrl("polygon", ChainData("Polygon", 137, "https://polygon-rpc.com"));
        _setChainWithDefaultRpcUrl(
            "polygon_amoy", ChainData("Polygon Amoy", 80002, "https://rpc-amoy.polygon.technology")
        );
        _setChainWithDefaultRpcUrl("avalanche", ChainData("Avalanche", 43114, "https://api.avax.network/ext/bc/C/rpc"));
        _setChainWithDefaultRpcUrl(
            "avalanche_fuji", ChainData("Avalanche Fuji", 43113, "https://api.avax-test.network/ext/bc/C/rpc")
        );
        _setChainWithDefaultRpcUrl(
            "bnb_smart_chain", ChainData("BNB Smart Chain", 56, "https://bsc-dataseed1.binance.org")
        );
        _setChainWithDefaultRpcUrl(
            "bnb_smart_chain_testnet",
            ChainData("BNB Smart Chain Testnet", 97, "https://rpc.ankr.com/bsc_testnet_chapel")
        );
        _setChainWithDefaultRpcUrl("gnosis_chain", ChainData("Gnosis Chain", 100, "https://rpc.gnosischain.com"));
        _setChainWithDefaultRpcUrl("moonbeam", ChainData("Moonbeam", 1284, "https://rpc.api.moonbeam.network"));
        _setChainWithDefaultRpcUrl(
            "moonriver", ChainData("Moonriver", 1285, "https://rpc.api.moonriver.moonbeam.network")
        );
        _setChainWithDefaultRpcUrl("moonbase", ChainData("Moonbase", 1287, "https://rpc.testnet.moonbeam.network"));
        _setChainWithDefaultRpcUrl("base_sepolia", ChainData("Base Sepolia", 84532, "https://sepolia.base.org"));
        _setChainWithDefaultRpcUrl("base", ChainData("Base", 8453, "https://mainnet.base.org"));
        _setChainWithDefaultRpcUrl("blast_sepolia", ChainData("Blast Sepolia", 168587773, "https://sepolia.blast.io"));
        _setChainWithDefaultRpcUrl("blast", ChainData("Blast", 81457, "https://rpc.blast.io"));
        _setChainWithDefaultRpcUrl("fantom_opera", ChainData("Fantom Opera", 250, "https://rpc.ankr.com/fantom/"));
        _setChainWithDefaultRpcUrl(
            "fantom_opera_testnet", ChainData("Fantom Opera Testnet", 4002, "https://rpc.ankr.com/fantom_testnet/")
        );
        _setChainWithDefaultRpcUrl("fraxtal", ChainData("Fraxtal", 252, "https://rpc.frax.com"));
        _setChainWithDefaultRpcUrl(
            "fraxtal_testnet", ChainData("Fraxtal Testnet", 2522, "https://rpc.testnet.frax.com")
        );
        _setChainWithDefaultRpcUrl(
            "berachain_bartio_testnet", ChainData("Berachain bArtio Testnet", 80084, "https://bartio.rpc.berachain.com")
        );
        _setChainWithDefaultRpcUrl("flare", ChainData("Flare", 14, "https://flare-api.flare.network/ext/C/rpc"));
        _setChainWithDefaultRpcUrl(
            "flare_coston2", ChainData("Flare Coston2", 114, "https://coston2-api.flare.network/ext/C/rpc")
        );

        _setChainWithDefaultRpcUrl("ink", ChainData("Ink", 57073, "https://rpc-gel.inkonchain.com"));
        _setChainWithDefaultRpcUrl(
            "ink_sepolia", ChainData("Ink Sepolia", 763373, "https://rpc-gel-sepolia.inkonchain.com")
        );

        _setChainWithDefaultRpcUrl("mode", ChainData("Mode", 34443, "https://mode.drpc.org"));
        _setChainWithDefaultRpcUrl("mode_sepolia", ChainData("Mode Sepolia", 919, "https://sepolia.mode.network"));

        _setChainWithDefaultRpcUrl("zora", ChainData("Zora", 7777777, "https://zora.drpc.org"));
        _setChainWithDefaultRpcUrl(
            "zora_sepolia", ChainData("Zora Sepolia", 999999999, "https://sepolia.rpc.zora.energy")
        );

        _setChainWithDefaultRpcUrl("race", ChainData("Race", 6805, "https://racemainnet.io"));
        _setChainWithDefaultRpcUrl("race_sepolia", ChainData("Race Sepolia", 6806, "https://racemainnet.io"));

        _setChainWithDefaultRpcUrl("radius", ChainData("Radius", 723487, "https://rpc.radiustech.xyz"));
        _setChainWithDefaultRpcUrl(
            "radius_testnet", ChainData("Radius Testnet", 72344, "https://rpc.testnet.radiustech.xyz")
        );

        _setChainWithDefaultRpcUrl("metal", ChainData("Metal", 1750, "https://metall2.drpc.org"));
        _setChainWithDefaultRpcUrl("metal_sepolia", ChainData("Metal Sepolia", 1740, "https://testnet.rpc.metall2.com"));

        _setChainWithDefaultRpcUrl("binary", ChainData("Binary", 624, "https://rpc.zero.thebinaryholdings.com"));
        _setChainWithDefaultRpcUrl(
            "binary_sepolia", ChainData("Binary Sepolia", 625, "https://rpc.zero.thebinaryholdings.com")
        );

        _setChainWithDefaultRpcUrl("orderly", ChainData("Orderly", 291, "https://rpc.orderly.network"));
        _setChainWithDefaultRpcUrl(
            "orderly_sepolia", ChainData("Orderly Sepolia", 4460, "https://testnet-rpc.orderly.org")
        );

        _setChainWithDefaultRpcUrl("unichain", ChainData("Unichain", 130, "https://mainnet.unichain.org"));
        _setChainWithDefaultRpcUrl(
            "unichain_sepolia", ChainData("Unichain Sepolia", 1301, "https://sepolia.unichain.org")
        );

        _setChainWithDefaultRpcUrl("tempo", ChainData("Tempo", 4217, "https://rpc.mainnet.tempo.xyz"));
        _setChainWithDefaultRpcUrl(
            "tempo_moderato", ChainData("Tempo Moderato", 42431, "https://rpc.moderato.tempo.xyz")
        );
        _setChainWithDefaultRpcUrl(
            "tempo_andantino", ChainData("Tempo Andantino", 42429, "https://rpc.testnet.tempo.xyz")
        );

        _setChainWithDefaultRpcUrl("grav", ChainData("Gravity", 127001, "https://mainnet-rpc.gravity.xyz"));
    }

    function _setChainWithDefaultRpcUrl(string memory chainAlias, ChainData memory chain) private {
        string memory rpcUrl = chain.rpcUrl;
        _defaultRpcUrls[chainAlias] = rpcUrl;
        chain.rpcUrl = "";
        setChain(chainAlias, chain);
        chain.rpcUrl = rpcUrl;
    }
}
