import { Interface, TransactionDescription, LogDescription } from 'ethers';
import { InvalidCalldataError, CalldataAuthorizationError, AbiEncodingMismatchError } from '@zenith/contracts';
export const ERC20_INTERFACE = new Interface([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)'
]);
export const ACROSS_V3_INTERFACE = new Interface([
    'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable',
    'function deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes message, uint256 maxCount) external payable',
    'event FundsDeposited(uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, uint32 depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address indexed recipient, address indexed inputToken, address outputToken, address exclusiveRelayer, bytes message)',
    'event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, uint32 depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address indexed recipient, address exclusiveRelayer, bytes message)'
]);
export const UNISWAP_V3_INTERFACE = new Interface([
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
    'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
    'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
    'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
    'function refundETH() external payable'
]);
export const REVERT_INTERFACE = new Interface([
    'error Error(string message)',
    'error Panic(uint256 code)'
]);
export const KNOWN_CUSTOM_REVERTS: Record<string, string> = {
    '0x39d35496': 'V3_TOO_LITTLE_RECEIVED: Simulated output was less than amountOutMinimum',
    '0x739dbe52': 'V3_TOO_MUCH_REQUESTED: Input amount exceeded maximum allowed',
    '0xc9f52c71': 'TOO_LITTLE_RECEIVED: Quoted amount received was below minimum threshold',
    '0xd4e0248e': 'V3_INVALID_AMOUNT_OUT: Output amount was invalid or zero',
    '0x316cf0eb': 'V3_INVALID_SWAP: Swap parameters or path invalid',
    '0x32b13d91': 'V3_INVALID_CALLER: Unauthorized callback sender'
};
const REGISTERED_INTERFACES: Interface[] = [
    ERC20_INTERFACE,
    ACROSS_V3_INTERFACE,
    UNISWAP_V3_INTERFACE
];
export interface DecodedCalldataResult {
    functionSelector: string;
    functionName: string;
    functionSignature: string;
    decodedArguments: any;
    iface: Interface;
    txDesc: TransactionDescription;
}
export function decodeCalldata(calldata: string): DecodedCalldataResult {
    if (!calldata || typeof calldata !== 'string') {
        throw new InvalidCalldataError('Calldata must be a non-empty hex string');
    }
    const normalized = calldata.startsWith('0x') ? calldata : `0x${calldata}`;
    if (normalized.length < 10) {
        throw new InvalidCalldataError(`Calldata length is too short: "${calldata}"`);
    }
    const selector = normalized.slice(0, 10).toLowerCase();
    for (const iface of REGISTERED_INTERFACES) {
        try {
            const txDesc = iface.parseTransaction({ data: normalized });
            if (txDesc) {
                return {
                    functionSelector: selector,
                    functionName: txDesc.name,
                    functionSignature: txDesc.fragment.format(),
                    decodedArguments: txDesc.args,
                    iface,
                    txDesc
                };
            }
        }
        catch { }
    }
    throw new CalldataAuthorizationError(`Unrecognized or unsupported function selector: "${selector}"`, selector);
}
export function reEncodeCalldata(functionNameOrSignature: string, args: any[]): string {
    for (const iface of REGISTERED_INTERFACES) {
        try {
            if (iface.hasFunction(functionNameOrSignature)) {
                return iface.encodeFunctionData(functionNameOrSignature, args);
            }
        }
        catch { }
    }
    throw new AbiEncodingMismatchError(functionNameOrSignature, `No registered interface matches function "${functionNameOrSignature}"`);
}
export function assertByteForByteEquivalence(originalCalldata: string, reEncodedCalldata: string, context = 'Calldata'): void {
    const norm1 = (originalCalldata.startsWith('0x') ? originalCalldata : `0x${originalCalldata}`).toLowerCase();
    const norm2 = (reEncodedCalldata.startsWith('0x') ? reEncodedCalldata : `0x${reEncodedCalldata}`).toLowerCase();
    if (norm1 !== norm2) {
        throw new AbiEncodingMismatchError(context, `Byte-for-byte mismatch: original (${norm1.length} chars) !== reEncoded (${norm2.length} chars)`);
    }
}
export interface DecodedRevertResult {
    type: 'ERROR_STRING' | 'PANIC' | 'CUSTOM_ERROR' | 'EMPTY' | 'UNKNOWN';
    message: string;
    code?: bigint | number;
    raw: string;
}
export function decodeRevertData(rawData: string): DecodedRevertResult {
    if (!rawData || rawData === '0x' || rawData === '') {
        return {
            type: 'EMPTY',
            message: 'Empty revert data (transaction reverted without error data)',
            raw: rawData || '0x'
        };
    }
    const normalized = rawData.startsWith('0x') ? rawData : `0x${rawData}`;
    const selector = normalized.slice(0, 10).toLowerCase();
    if (selector === '0x08c379a0') {
        try {
            const decoded = REVERT_INTERFACE.decodeErrorResult('Error', normalized);
            return {
                type: 'ERROR_STRING',
                message: decoded[0] || 'Unknown revert reason',
                raw: rawData
            };
        }
        catch { }
    }
    if (selector === '0x4e487b71') {
        try {
            const decoded = REVERT_INTERFACE.decodeErrorResult('Panic', normalized);
            return {
                type: 'PANIC',
                code: decoded[0],
                message: `Solidity panic code: ${decoded[0].toString()}`,
                raw: rawData
            };
        }
        catch { }
    }
    if (KNOWN_CUSTOM_REVERTS[selector]) {
        return {
            type: 'CUSTOM_ERROR',
            message: KNOWN_CUSTOM_REVERTS[selector],
            raw: rawData
        };
    }
    return {
        type: 'UNKNOWN',
        message: `Unknown revert data with selector ${selector}`,
        raw: rawData
    };
}
export interface DecodedReceiptEvent {
    eventName: string;
    contractAddress: string;
    topics: string[];
    args: any;
}
export function decodeReceiptEvents(logs: any[]): DecodedReceiptEvent[] {
    if (!Array.isArray(logs))
        return [];
    const results: DecodedReceiptEvent[] = [];
    for (const log of logs) {
        if (!log || !log.topics || log.topics.length === 0)
            continue;
        const contractAddress = (log.address || '').toLowerCase();
        const topics = log.topics;
        const data = log.data || '0x';
        let decoded = false;
        for (const iface of REGISTERED_INTERFACES) {
            try {
                const parsed: LogDescription | null = iface.parseLog({ topics, data });
                if (parsed) {
                    results.push({
                        eventName: parsed.name,
                        contractAddress,
                        topics,
                        args: parsed.args
                    });
                    decoded = true;
                    break;
                }
            }
            catch { }
        }
        if (!decoded) {
            results.push({
                eventName: 'UNKNOWN',
                contractAddress,
                topics,
                args: {}
            });
        }
    }
    return results;
}
