pragma solidity >=0.8.13 <0.9.0;

import {Test} from "../src/Test.sol";
import {Vm, VmSafe} from "../src/Vm.sol";

contract VmTest is Test {
    function test_VmInterfaceId() public pure {
        assertEq(type(Vm).interfaceId, bytes4(0x6fde05ab), "Vm");
    }

    function test_VmSafeInterfaceId() public pure {
        assertEq(type(VmSafe).interfaceId, bytes4(0x9b107c4f), "VmSafe");
    }
}
