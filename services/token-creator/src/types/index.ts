import { PublicKey, Transaction } from '@solana/web3.js';

export interface TokenSuggestion {
  name: string;
  symbol: string;
  description: string;
  theme: string;
  marketCap: number;
  confidence: number;
  reasoning: string;
  basedOnTweet: string;
  suggestedAt: Date;
}

export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  attributes: Array<{
    trait_type: string;
    value: string;
  }>;
}

export interface TokenCreationRequest {
  tokenSuggestion: TokenSuggestion;
  metadata: TokenMetadata;
  initialSupply: number;
  decimals: number;
  enableMinting: boolean;
  enableFreezing: boolean;
  uploadToIPFS: boolean;
}

export interface TokenCreationResult {
  mintAddress: string;
  tokenAddress: string;
  metadataAddress?: string;
  transactionSignature: string;
  createdAt: Date;
  costs: {
    transactionFee: number;
    mintRent: number;
    metadataRent?: number;
    ipfsUpload?: number;
    total: number;
  };
  status: 'created' | 'failed' | 'pending';
  error?: string;
}

export interface PumpFunDeployment {
  tokenAddress: string;
  pumpFunUrl: string;
  pumpFunId: string;
  deployedAt: Date;
  initialLiquidity: number;
  status: 'deployed' | 'failed' | 'pending';
  error?: string;
}

export interface SolanaWalletConfig {
  publicKey: PublicKey;
  secretKey: Uint8Array;
  balance: number;
  lastUpdated: Date;
}

export interface ImageGenerationRequest {
  tokenName: string;
  tokenSymbol: string;
  theme: string;
  style: 'meme' | 'professional' | 'cartoon' | 'abstract';
  colors: string[];
  description: string;
}

export interface GeneratedImage {
  buffer: Buffer;
  format: 'png' | 'jpg';
  width: number;
  height: number;
  size: number;
  metadata: {
    theme: string;
    style: string;
    colors: string[];
  };
}

export interface IPFSUploadResult {
  hash: string;
  url: string;
  size: number;
  uploadedAt: Date;
  cost: number;
}

export interface TokenAnalytics {
  mintAddress: string;
  tokenAddress: string;
  currentSupply: number;
  holders: number;
  volume24h: number;
  priceUSD: number;
  marketCap: number;
  liquidityUSD: number;
  createdAt: Date;
  lastUpdated: Date;
}

export interface ServiceStatus {
  isActive: boolean;
  redisConnected: boolean;
  solanaConnected: boolean;
  walletBalance: number;
  tokensCreated: number;
  successRate: number;
  avgCreationTime: number;
  costAnalytics: {
    totalCosts: number;
    avgCostPerToken: number;
    budgetUsage: number;
  };
  lastTokenCreated?: Date;
  errorCount: number;
  uptime: number;
}

export interface TokenCreatorConfig {
  enableAutoCreation: boolean;
  minConfidenceThreshold: number;
  maxDailyTokens: number;
  defaultSupply: number;
  defaultDecimals: number;
  enablePumpFun: boolean;
  enableIPFS: boolean;
  pumpFunBondingCurve: {
    virtualSolReserves: number;
    virtualTokenReserves: number;
    realSolReserves: number;
    realTokenReserves: number;
  };
}

export interface MarketMakingConfig {
  enableMarketMaking: boolean;
  initialLiquiditySOL: number;
  slippageTolerance: number;
  maxPriceImpact: number;
  rebalanceFrequency: number;
}
