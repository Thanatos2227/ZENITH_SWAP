pragma solidity >=0.8.13 <0.9.0;

import {Test} from "../src/Test.sol";

contract StdChainsMock is Test {
    function exposedGetChain(string memory chainAlias) public returns (Chain memory) {
        return getChain(chainAlias);
    }

    function exposedGetChain(uint256 chainId) public returns (Chain memory) {
        return getChain(chainId);
    }

    function exposedSetChain(string memory chainAlias, ChainData memory chainData) public {
        setChain(chainAlias, chainData);
    }

    function exposedSetFallbackToDefaultRpcUrls(bool useDefault) public {
        setFallbackToDefaultRpcUrls(useDefault);
    }
}

contract StdChainsTest is Test {
    function test_ChainRpcInitialization() public {

        assertEq(getChain(1).rpcUrl, "https://ethereum.reth.rs/rpc");
        assertEq(getChain("optimism_sepolia").rpcUrl, "https://sepolia.optimism.io/");
        assertEq(getChain("arbitrum_one_sepolia").rpcUrl, "https://sepolia-rollup.arbitrum.io/rpc/");

        assertEq(getChain("arbitrum_nova").rpcUrl, "https://nova.arbitrum.io/rpc");
        vm.setEnv("ARBITRUM_NOVA_RPC_URL", "myoverride");
        assertEq(getChain("arbitrum_nova").rpcUrl, "myoverride");
        vm.setEnv("ARBITRUM_NOVA_RPC_URL", "https://nova.arbitrum.io/rpc");

        vm.setEnv("MAINNET_RPC_URL", "myoverride2");
        assertEq(getChain("mainnet").rpcUrl, "https://ethereum.reth.rs/rpc");

        assertEq(getChain(31337).rpcUrl, "http://127.0.0.1:8545");
        assertEq(getChain("sepolia").rpcUrl, "https://sepolia.infura.io/v3/b9794ad1ddf84dfb8c34d6bb5dca2001");
    }

    function _testRpc(string memory rpcAlias) internal {
        string memory rpcUrl = getChain(rpcAlias).rpcUrl;
        vm.createSelectFork(rpcUrl);
    }

    function test_RevertIf_ChainNotFound() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains getChain(string): Chain with alias \"does_not_exist\" not found.");
        stdChainsMock.exposedGetChain("does_not_exist");
    }

    function test_RevertIf_SetChain_ChainIdExist_FirstTest() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains setChain(string,ChainData): Chain ID 31337 already used by \"anvil\".");
        stdChainsMock.exposedSetChain("anvil2", ChainData("Anvil", 31337, "URL"));
    }

    function test_RevertIf_ChainBubbleUp() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        stdChainsMock.exposedSetChain("needs_undefined_env_var", ChainData("", 123456789, ""));

        vm.expectRevert();
        stdChainsMock.exposedGetChain("needs_undefined_env_var");
    }

    function test_RevertIf_SetChain_ChainIdExists_SecondTest() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        stdChainsMock.exposedSetChain("custom_chain", ChainData("Custom Chain", 123456789, "https://custom.chain/"));

        vm.expectRevert('StdChains setChain(string,ChainData): Chain ID 123456789 already used by "custom_chain".');

        stdChainsMock.exposedSetChain("another_custom_chain", ChainData("", 123456789, ""));
    }

    function test_SetChain() public {
        setChain("custom_chain", ChainData("Custom Chain", 123456789, "https://custom.chain/"));
        Chain memory customChain = getChain("custom_chain");
        assertEq(customChain.name, "Custom Chain");
        assertEq(customChain.chainId, 123456789);
        assertEq(customChain.chainAlias, "custom_chain");
        assertEq(customChain.rpcUrl, "https://custom.chain/");
        Chain memory chainById = getChain(123456789);
        assertEq(chainById.name, customChain.name);
        assertEq(chainById.chainId, customChain.chainId);
        assertEq(chainById.chainAlias, customChain.chainAlias);
        assertEq(chainById.rpcUrl, customChain.rpcUrl);
        customChain.name = "Another Custom Chain";
        customChain.chainId = 987654321;
        setChain("another_custom_chain", customChain);
        Chain memory anotherCustomChain = getChain("another_custom_chain");
        assertEq(anotherCustomChain.name, "Another Custom Chain");
        assertEq(anotherCustomChain.chainId, 987654321);
        assertEq(anotherCustomChain.chainAlias, "another_custom_chain");
        assertEq(anotherCustomChain.rpcUrl, "https://custom.chain/");

        chainById = getChain(123456789);
        assertEq(chainById.name, "Custom Chain");
        assertEq(chainById.chainId, 123456789);
    }

    function test_RevertIf_SetEmptyAlias() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains setChain(string,ChainData): Chain alias cannot be the empty string.");
        stdChainsMock.exposedSetChain("", ChainData("", 123456789, ""));
    }

    function test_RevertIf_SetNoChainId0() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains setChain(string,ChainData): Chain ID cannot be 0.");
        stdChainsMock.exposedSetChain("alias", ChainData("", 0, ""));
    }

    function test_RevertIf_GetNoChainId0() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains getChain(uint256): Chain ID cannot be 0.");
        stdChainsMock.exposedGetChain(0);
    }

    function test_RevertIf_GetNoEmptyAlias() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains getChain(string): Chain alias cannot be the empty string.");
        stdChainsMock.exposedGetChain("");
    }

    function test_RevertIf_ChainNotInitialized() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains getChain(string): Chain with alias \"no_such_alias\" not found.");
        stdChainsMock.exposedGetChain("no_such_alias");
    }

    function test_RevertIf_ChainAliasNotFound() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        vm.expectRevert("StdChains getChain(uint256): Chain with ID 321 not found.");

        stdChainsMock.exposedGetChain(321);
    }

    function test_SetChain_ExistingOne() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        setChain("custom_chain", ChainData("Custom Chain", 123456789, "https://custom.chain/"));
        assertEq(getChain(123456789).chainId, 123456789);

        setChain("custom_chain", ChainData("Modified Chain", 9999999999999999999, "https://modified.chain/"));
        vm.expectRevert("StdChains getChain(uint256): Chain with ID 123456789 not found.");
        stdChainsMock.exposedGetChain(123456789);

        Chain memory modifiedChain = getChain(9999999999999999999);
        assertEq(modifiedChain.name, "Modified Chain");
        assertEq(modifiedChain.chainId, 9999999999999999999);
        assertEq(modifiedChain.rpcUrl, "https://modified.chain/");
    }

    function test_RevertIf_DontUseDefaultRpcUrl() public {

        StdChainsMock stdChainsMock = new StdChainsMock();

        stdChainsMock.exposedSetFallbackToDefaultRpcUrls(false);
        vm.expectRevert();
        stdChainsMock.exposedGetChain(31337);
        vm.expectRevert();
        stdChainsMock.exposedGetChain("sepolia");
    }
}
