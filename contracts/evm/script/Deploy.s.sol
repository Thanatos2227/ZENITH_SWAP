pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ZenithTreasury} from "../src/treasury/ZenithTreasury.sol";
import {ZenithFeeController} from "../src/treasury/ZenithFeeController.sol";
import {ZenithV1Factory} from "../src/v1/ZenithV1Factory.sol";
import {ZenithV1Router} from "../src/v1/ZenithV1Router.sol";
import {ZenithV2Factory} from "../src/v2/ZenithV2Factory.sol";
import {ZenithV2Router} from "../src/v2/ZenithV2Router.sol";
import {ZenithV3Factory} from "../src/v3/ZenithV3Factory.sol";
import {ZenithV3Router} from "../src/v3/ZenithV3Router.sol";
import {ZenithV3PositionManager} from "../src/v3/ZenithV3PositionManager.sol";
import {ZenithRouter} from "../src/router/ZenithRouter.sol";
import {ZenithCrossChainRouter} from "../src/ZenithCrossChainRouter.sol";
import {ZenithCircuitBreaker} from "../src/ZenithCircuitBreaker.sol";

contract DeployZenith is Script {
    function run() external returns (
        address treasuryAddr,
        address feeControllerAddr,
        address circuitBreakerAddr,
        address v1FactoryAddr,
        address v1RouterAddr,
        address v2FactoryAddr,
        address v2RouterAddr,
        address v3FactoryAddr,
        address v3RouterAddr,
        address v3PositionManagerAddr,
        address unifiedRouterAddr,
        address crossChainRouterAddr
    ) {
        require(block.chainid != 0, "DeployZenith: Invalid chainId");

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(deployerPrivateKey != 0, "DeployZenith: DEPLOYER_PRIVATE_KEY required");

        address governance = vm.envAddress("GOVERNANCE_MULTISIG");
        require(governance != address(0), "DeployZenith: GOVERNANCE_MULTISIG cannot be zero address");

        address emergencyGuardian = vm.envAddress("EMERGENCY_GUARDIAN");
        require(emergencyGuardian != address(0), "DeployZenith: EMERGENCY_GUARDIAN cannot be zero address");

        address wethAddress = vm.envAddress("WETH_ADDRESS");
        require(wethAddress != address(0), "DeployZenith: WETH_ADDRESS cannot be zero address");

        address permit2Address = vm.envOr("PERMIT2_ADDRESS", address(0x000000000022D473030F116dDEE9F6B43aC78BA3));
        require(permit2Address != address(0), "DeployZenith: PERMIT2_ADDRESS cannot be zero address");

        console.log("=== Deploying ZENITH SWAP Canonical Protocol Suite ===");
        console.log("Chain ID:           ", block.chainid);
        console.log("Governance:         ", governance);
        console.log("Emergency Guardian: ", emergencyGuardian);
        console.log("WETH Address:       ", wethAddress);
        console.log("Permit2 Address:    ", permit2Address);

        vm.startBroadcast(deployerPrivateKey);

        ZenithTreasury treasury = new ZenithTreasury(governance);
        treasuryAddr = address(treasury);
        console.log("1. ZenithTreasury:          ", treasuryAddr);

        ZenithCircuitBreaker circuitBreaker = new ZenithCircuitBreaker(governance, emergencyGuardian);
        circuitBreakerAddr = address(circuitBreaker);
        console.log("2. ZenithCircuitBreaker:     ", circuitBreakerAddr);

        ZenithFeeController feeController = new ZenithFeeController(governance, treasuryAddr);
        feeControllerAddr = address(feeController);
        console.log("3. ZenithFeeController:      ", feeControllerAddr);

        ZenithV1Factory v1Factory = new ZenithV1Factory(governance, treasuryAddr);
        v1FactoryAddr = address(v1Factory);
        ZenithV1Router v1Router = new ZenithV1Router(v1FactoryAddr, wethAddress);
        v1RouterAddr = address(v1Router);
        console.log("4. ZenithV1Factory:          ", v1FactoryAddr);
        console.log("5. ZenithV1Router:           ", v1RouterAddr);

        ZenithV2Factory v2Factory = new ZenithV2Factory(governance, feeControllerAddr, treasuryAddr);
        v2FactoryAddr = address(v2Factory);
        ZenithV2Router v2Router = new ZenithV2Router(v2FactoryAddr, wethAddress);
        v2RouterAddr = address(v2Router);
        console.log("6. ZenithV2Factory:          ", v2FactoryAddr);
        console.log("7. ZenithV2Router:           ", v2RouterAddr);

        ZenithV3Factory v3Factory = new ZenithV3Factory(governance);
        v3FactoryAddr = address(v3Factory);
        ZenithV3Router v3Router = new ZenithV3Router(v3FactoryAddr, wethAddress);
        v3RouterAddr = address(v3Router);
        ZenithV3PositionManager v3PositionManager = new ZenithV3PositionManager(v3FactoryAddr, wethAddress);
        v3PositionManagerAddr = address(v3PositionManager);
        console.log("8. ZenithV3Factory:          ", v3FactoryAddr);
        console.log("9. ZenithV3Router:           ", v3RouterAddr);
        console.log("10. ZenithV3PositionManager: ", v3PositionManagerAddr);

        ZenithRouter unifiedRouter = new ZenithRouter(
            governance,
            wethAddress,
            treasuryAddr,
            feeControllerAddr,
            v1RouterAddr,
            v2RouterAddr,
            v3RouterAddr
        );
        unifiedRouterAddr = address(unifiedRouter);
        console.log("11. ZenithUnifiedRouter:    ", unifiedRouterAddr);

        ZenithCrossChainRouter crossChainRouter = new ZenithCrossChainRouter(
            treasuryAddr,
            feeControllerAddr,
            circuitBreakerAddr,
            permit2Address
        );
        crossChainRouterAddr = address(crossChainRouter);
        console.log("12. ZenithCrossChainRouter: ", crossChainRouterAddr);

        // Post-Deployment Authorizations
        treasury.setFeeCollector(unifiedRouterAddr, true);
        treasury.setFeeCollector(crossChainRouterAddr, true);
        feeController.setFeeCollector(unifiedRouterAddr, true);
        feeController.setFeeCollector(crossChainRouterAddr, true);
        console.log("13. Post-Deployment Authorizations Wired Successfully");

        vm.stopBroadcast();

        console.log("=== Canonical Deployment Complete ===");
    }
}

