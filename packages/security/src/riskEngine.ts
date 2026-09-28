import { Token, TokenSecurityProfile } from '@zenith/types';
export interface RiskEvaluation {
    overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskScore: number;
    isTradeable: boolean;
    warnings: string[];
    reasons: string[];
    securityProfile: TokenSecurityProfile;
}
export class TokenRiskEngine {
    public evaluateToken(token: Token): RiskEvaluation {
        if (token.isNative) {
            return {
                overallRiskLevel: 'LOW',
                riskScore: 0,
                isTradeable: true,
                warnings: [],
                reasons: ['Native network gas asset'],
                securityProfile: {
                    isHoneypot: false,
                    buyTaxPercent: 0,
                    sellTaxPercent: 0,
                    transferTaxPercent: 0,
                    canBlacklist: false,
                    canMintArbitrary: false,
                    isProxy: false,
                    liquidityLockedPercent: 100,
                    holderConcentrationTop10Percent: 5,
                    hasMaliciousPatterns: false,
                    riskScore: 0,
                    warnings: []
                }
            };
        }
        const profile = token.securityProfile || this.generateDefaultProfile(token);
        let riskScore = 0;
        const warnings: string[] = [...profile.warnings];
        const reasons: string[] = [];
        if (profile.isHoneypot) {
            riskScore += 100;
            warnings.push('CRITICAL: Token identified as a Honeypot (tokens cannot be sold).');
            reasons.push('Honeypot code detected in contract');
        }
        if (profile.sellTaxPercent > 10) {
            riskScore += 35;
            warnings.push(`High sell fee: ${profile.sellTaxPercent}%. Substantial loss on exit.`);
            reasons.push(`Sell tax is ${profile.sellTaxPercent}%`);
        }
        else if (profile.sellTaxPercent > 0) {
            riskScore += 10;
            warnings.push(`Token has a ${profile.sellTaxPercent}% sell tax.`);
        }
        if (profile.buyTaxPercent > 10) {
            riskScore += 25;
            warnings.push(`High buy fee: ${profile.buyTaxPercent}%.`);
            reasons.push(`Buy tax is ${profile.buyTaxPercent}%`);
        }
        if (profile.canBlacklist) {
            riskScore += 15;
            reasons.push('Contract contains blacklist function');
        }
        if (profile.canMintArbitrary && token.verificationTier !== 'VERIFIED_CANONICAL') {
            riskScore += 25;
            warnings.push('Contract owner can mint arbitrary new tokens.');
            reasons.push('Unbounded minting capability without canonical status');
        }
        if (profile.liquidityLockedPercent < 50 && token.verificationTier === 'UNVERIFIED') {
            riskScore += 20;
            warnings.push('Less than 50% of liquidity is locked. Risk of rug pull.');
            reasons.push('Low liquidity lock ratio');
        }
        if (profile.holderConcentrationTop10Percent > 80 && token.verificationTier !== 'VERIFIED_CANONICAL') {
            riskScore += 15;
            warnings.push('Top 10 holders own more than 80% of supply.');
            reasons.push('Extreme holder concentration');
        }
        if (profile.hasMaliciousPatterns) {
            riskScore += 50;
            warnings.push('Contract contains suspicious bytecode signatures.');
            reasons.push('Suspicious bytecode patterns detected');
        }
        riskScore = Math.min(100, Math.max(0, riskScore));
        let overallRiskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        if (riskScore >= 70 || profile.isHoneypot) {
            overallRiskLevel = 'CRITICAL';
        }
        else if (riskScore >= 40) {
            overallRiskLevel = 'HIGH';
        }
        else if (riskScore >= 20) {
            overallRiskLevel = 'MEDIUM';
        }
        const isTradeable = overallRiskLevel !== 'CRITICAL' && !profile.isHoneypot;
        return {
            overallRiskLevel,
            riskScore,
            isTradeable,
            warnings,
            reasons,
            securityProfile: profile
        };
    }
    private generateDefaultProfile(token: Token): TokenSecurityProfile {
        if (token.verificationTier === 'VERIFIED_CANONICAL') {
            return {
                isHoneypot: false,
                buyTaxPercent: 0,
                sellTaxPercent: 0,
                transferTaxPercent: 0,
                canBlacklist: false,
                canMintArbitrary: false,
                isProxy: false,
                liquidityLockedPercent: 100,
                holderConcentrationTop10Percent: 20,
                hasMaliciousPatterns: false,
                riskScore: 0,
                warnings: []
            };
        }
        return {
            isHoneypot: false,
            buyTaxPercent: 0,
            sellTaxPercent: 0,
            transferTaxPercent: 0,
            canBlacklist: false,
            canMintArbitrary: false,
            isProxy: false,
            liquidityLockedPercent: 50,
            holderConcentrationTop10Percent: 45,
            hasMaliciousPatterns: false,
            riskScore: 25,
            warnings: ['Unverified token. Verify contract address before trading.']
        };
    }
}
export const defaultTokenRiskEngine = new TokenRiskEngine();
