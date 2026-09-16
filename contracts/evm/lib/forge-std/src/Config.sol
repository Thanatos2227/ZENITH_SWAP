pragma solidity ^0.8.13;

import {console} from "./console.sol";
import {StdConfig} from "./StdConfig.sol";
import {CommonBase} from "./Base.sol";

abstract contract Config is CommonBase {

    StdConfig internal config;

    uint256[] internal chainIds;

    mapping(uint256 => uint256) internal forkOf;

    function _loadConfig(string memory filePath, bool writeToFile) internal {
        console.log("----------");
        console.log(string.concat("Loading config from '", filePath, "'"));
        config = new StdConfig(filePath, writeToFile);
        vm.makePersistent(address(config));
        console.log("Config successfully loaded");
        console.log("----------");
    }

    function _loadConfigAndForks(string memory filePath, bool writeToFile) internal {
        _loadConfig(filePath, writeToFile);

        console.log("Setting up forks for the configured chains...");
        uint256[] memory chains = config.getChainIds();
        for (uint256 i = 0; i < chains.length; i++) {
            uint256 chainId = chains[i];
            uint256 forkId = vm.createFork(config.getRpcUrl(chainId));
            forkOf[chainId] = forkId;
            chainIds.push(chainId);
        }
        console.log("Forks successfully created");
        console.log("----------");
    }
}
