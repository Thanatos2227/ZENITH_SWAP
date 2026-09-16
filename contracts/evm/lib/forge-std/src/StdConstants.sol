pragma solidity >=0.8.13 <0.9.0;

import {IMulticall3} from "./interfaces/IMulticall3.sol";
import {Vm} from "./Vm.sol";

library StdConstants {

    Vm internal constant VM = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    address internal constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;

    address internal constant CREATE2_FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    address internal constant DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    address internal constant DEFAULT_TEST_CONTRACT = 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f;

    IMulticall3 internal constant MULTICALL3_ADDRESS = IMulticall3(0xcA11bde05977b3631167028862bE2a173976CA11);

    uint256 internal constant SECP256K1_ORDER =
        115792089237316195423570985008687907852837564279074904382605163141518161494337;
}
