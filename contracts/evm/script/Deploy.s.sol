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
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Governance is an explicit deployment input. Never silently bind protocol
        // administration to a hard-coded personal or test wallet address.
        address governance = vm.envOr("GOVERNANCE_MULTISIG", address(0));
        require(governance != address(0), "DeployZenith: GOVERNANCE_MULTISIG is required");
        address emergencyGuardian = vm.envOr("EMERGENCY_GUARDIAN", governance);
        address wethAddress = vm.envOr("WETH_ADDRESS", address(0));
        require(wethAddress != address(0), "DeployZenith: WETH_ADDRESS cannot be zero address");
        address permit2Address = vm.envOr("PERMIT2_ADDRESS", address(0x000000000022D473030F116dDEE9F6B43aC78BA3));

        console.log("=== Deploying ZENITH SWAP Canonical Protocol Suite ===");
        console.log("Governance:               ", governance);
        console.log("Deployment Operator:     ", deployer);
        console.log("Emergency Guardian:      ", emergencyGuardian);
        console.log("WETH Address:            ", wethAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Bootstrap mutable treasury administration under the deployment operator
        // so collectors can be authorized before the final governance handover.
        ZenithTreasury treasury = new ZenithTreasury(deployer);
        treasuryAddr = address(treasury);
        console.log("1. ZenithTreasury:          ", treasuryAddr);

        ZenithFeeController feeController = new ZenithFeeController(deployer, treasuryAddr);
        feeControllerAddr = address(feeController);
        console.log("2. ZenithFeeController:      ", feeControllerAddr);

        ZenithV1Factory v1Factory = new ZenithV1Factory(governance, treasuryAddr);
        v1FactoryAddr = address(v1Factory);
        ZenithV1Router v1Router = new ZenithV1Router(v1FactoryAddr, wethAddress);
        v1RouterAddr = address(v1Router);
        console.log("3. ZenithV1Factory:          ", v1FactoryAddr);
        console.log("4. ZenithV1Router:           ", v1RouterAddr);

        ZenithV2Factory v2Factory = new ZenithV2Factory(governance, feeControllerAddr, treasuryAddr);
        v2FactoryAddr = address(v2Factory);
        ZenithV2Router v2Router = new ZenithV2Router(v2FactoryAddr, wethAddress);
        v2RouterAddr = address(v2Router);
        console.log("5. ZenithV2Factory:          ", v2FactoryAddr);
        console.log("6. ZenithV2Router:           ", v2RouterAddr);

        ZenithV3Factory v3Factory = new ZenithV3Factory(governance);
        v3FactoryAddr = address(v3Factory);
        ZenithV3Router v3Router = new ZenithV3Router(v3FactoryAddr, wethAddress);
        v3RouterAddr = address(v3Router);
        ZenithV3PositionManager v3PositionManager = new ZenithV3PositionManager(v3FactoryAddr, wethAddress);
        v3PositionManagerAddr = address(v3PositionManager);
        console.log("7. ZenithV3Factory:          ", v3FactoryAddr);
        console.log("8. ZenithV3Router:           ", v3RouterAddr);
        console.log("9. ZenithV3PositionManager:  ", v3PositionManagerAddr);

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
        console.log("10. ZenithUnifiedRouter:     ", unifiedRouterAddr);

        ZenithCircuitBreaker circuitBreaker = new ZenithCircuitBreaker(governance, emergencyGuardian);
        ZenithCrossChainRouter crossChainRouter = new ZenithCrossChainRouter(
            treasuryAddr,
            feeControllerAddr,
            address(circuitBreaker),
            permit2Address
        );
        crossChainRouterAddr = address(crossChainRouter);
        console.log("11. ZenithCrossChainRouter:  ", crossChainRouterAddr);

        // Both routers call the treasury directly when collecting protocol fees.
        treasury.setFeeCollector(unifiedRouterAddr, true);
        treasury.setFeeCollector(crossChainRouterAddr, true);

        // Complete the administrative handover only when governance differs from
        // the deployment operator. The target governance must accept explicitly.
        if (governance != deployer) {
            treasury.transferGovernance(governance);
            feeController.transferGovernance(governance);
        }

        vm.stopBroadcast();

        console.log("=== Canonical Deployment Complete ===");
        console.log("Treasury governance pending: ", governance);
        console.log("Treasury collectors authorized: unified + cross-chain");
    }
}
