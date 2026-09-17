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
    address internal constant PROFESSIONAL_WALLET = 0x739B5579C5d617534803d5129F9563B30E42e3a8;

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
        address deployerGovernance = vm.addr(deployerPrivateKey);
        address governance = vm.envOr("GOVERNANCE_MULTISIG", PROFESSIONAL_WALLET);
        address emergencyGuardian = vm.envOr("EMERGENCY_GUARDIAN", governance);
        address wethAddress = vm.envOr("WETH_ADDRESS", address(0));
        require(wethAddress != address(0), "DeployZenith: WETH_ADDRESS cannot be zero address");
        address permit2Address = vm.envOr("PERMIT2_ADDRESS", address(0x000000000022D473030F116dDEE9F6B43aC78BA3));

        console.log("=== Deploying ZENITH SWAP Canonical Protocol Suite ===");
        console.log("Professional Governance: ", governance);
        console.log("Deployment Operator:     ", deployerGovernance);
        console.log("Emergency Guardian:      ", emergencyGuardian);
        console.log("WETH Address:            ", wethAddress);

        vm.startBroadcast(deployerPrivateKey);

        // Treasury and fee controller are bootstrapped under the deployer so the
        // deployment can authorize protocol routers before handing governance to
        // the professional wallet. No fabricated contract address is used.
        ZenithTreasury treasury = new ZenithTreasury(deployerGovernance);
        treasuryAddr = address(treasury);
        console.log("1. ZenithTreasury:          ", treasuryAddr);

        ZenithFeeController feeController = new ZenithFeeController(deployerGovernance, treasuryAddr);
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
        // Authorize them before governance is handed to the professional wallet.
        treasury.setFeeCollector(unifiedRouterAddr, true);
        treasury.setFeeCollector(crossChainRouterAddr, true);

        // Transfer administrative control of the treasury and fee controller to
        // the supplied professional wallet. The wallet must call acceptGovernance()
        // on each contract to complete the two-step ownership transfer.
        if (governance != deployerGovernance) {
            treasury.transferGovernance(governance);
            feeController.transferGovernance(governance);
        }

        vm.stopBroadcast();

        console.log("=== Canonical Deployment Complete ===");
        console.log("Treasury governance pending: ", governance);
        console.log("Treasury collectors authorized: unified + cross-chain");
    }
}
