import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  clusterApiUrl
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction
} from '@solana/spl-token';
import { Redis } from 'redis';
import {
  TokenCreationRequest,
  TokenCreationResult,
  SolanaWalletConfig,
  TokenMetadata,
  PumpFunDeployment
} from '../types';

export class SolanaService {
  private connection: Connection;
  private wallet: Keypair;
  private redis: Redis;
  private network: string;

  constructor(redis: Redis) {
    this.network = process.env.SOLANA_NETWORK || 'devnet';
    this.connection = new Connection(
      this.network === 'mainnet' 
        ? process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
        : clusterApiUrl('devnet'),
      'confirmed'
    );

    // Initialize wallet from private key
    const privateKeyString = process.env.SOLANA_PRIVATE_KEY;
    if (!privateKeyString) {
      throw new Error('SOLANA_PRIVATE_KEY environment variable is required');
    }

    try {
      const privateKey = JSON.parse(privateKeyString);
      this.wallet = Keypair.fromSecretKey(new Uint8Array(privateKey));
    } catch (error) {
      throw new Error('Invalid SOLANA_PRIVATE_KEY format. Must be JSON array of numbers');
    }

    this.redis = redis;
    console.log(`🔗 Solana service initialized on ${this.network}`);
    console.log(`📍 Wallet address: ${this.wallet.publicKey.toString()}`);
  }

  async createToken(request: TokenCreationRequest): Promise<TokenCreationResult> {
    const startTime = Date.now();

    try {
      console.log(`🪙 Creating token: ${request.tokenSuggestion.name} (${request.tokenSuggestion.symbol})`);

      // Check wallet balance
      const balance = await this.getWalletBalance();
      const estimatedCost = await this.estimateTokenCreationCost();

      if (balance < estimatedCost) {
        throw new Error(`Insufficient balance. Required: ${estimatedCost} SOL, Available: ${balance} SOL`);
      }

      // Create mint account
      const mint = Keypair.generate();

      const transaction = new Transaction();

      // Calculate rent for mint account
      const mintRent = await getMinimumBalanceForRentExemptMint(this.connection);

      // Create account instruction
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: this.wallet.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        })
      );

      // Initialize mint instruction
      transaction.add(
        createInitializeMintInstruction(
          mint.publicKey,
          request.decimals,
          this.wallet.publicKey, // mint authority
          request.enableFreezing ? this.wallet.publicKey : null, // freeze authority
        )
      );

      // Send transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.wallet, mint],
        { commitment: 'confirmed' }
      );

      console.log(`✅ Mint created: ${mint.publicKey.toString()}`);
      console.log(`📝 Transaction: ${signature}`);

      // Create token account for initial mint
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.wallet,
        mint.publicKey,
        this.wallet.publicKey
      );

      // Mint initial supply
      await mintTo(
        this.connection,
        this.wallet,
        mint.publicKey,
        tokenAccount.address,
        this.wallet.publicKey,
        request.initialSupply * Math.pow(10, request.decimals)
      );

      // Disable minting if requested
      if (!request.enableMinting) {
        await setAuthority(
          this.connection,
          this.wallet,
          mint.publicKey,
          this.wallet.publicKey,
          AuthorityType.MintTokens,
          null
        );
        console.log('🔒 Mint authority disabled');
      }

      // Calculate actual costs
      const transactionFee = await this.connection.getFeeForMessage(
        transaction.compileMessage(),
        'confirmed'
      );

      const result: TokenCreationResult = {
        mintAddress: mint.publicKey.toString(),
        tokenAddress: tokenAccount.address.toString(),
        transactionSignature: signature,
        createdAt: new Date(),
        costs: {
          transactionFee: (transactionFee?.value || 0) / LAMPORTS_PER_SOL,
          mintRent: mintRent / LAMPORTS_PER_SOL,
          total: (mintRent + (transactionFee?.value || 0)) / LAMPORTS_PER_SOL
        },
        status: 'created'
      };

      // Save token creation record
      await this.saveTokenRecord(result, request);

      // Track creation metrics
      await this.trackCreationMetrics(Date.now() - startTime, true, result.costs.total);

      console.log(`🎉 Token ${request.tokenSuggestion.symbol} created successfully!`);
      return result;

    } catch (error) {
      console.error('Token creation failed:', error);

      // Track failure metrics
      await this.trackCreationMetrics(Date.now() - startTime, false, 0);

      const failureResult: TokenCreationResult = {
        mintAddress: '',
        tokenAddress: '',
        transactionSignature: '',
        createdAt: new Date(),
        costs: {
          transactionFee: 0,
          mintRent: 0,
          total: 0
        },
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      return failureResult;
    }
  }

  async deployToPumpFun(tokenResult: TokenCreationResult, metadata: TokenMetadata): Promise<PumpFunDeployment> {
    try {
      console.log(`🚀 Deploying ${metadata.symbol} to pump.fun...`);

      // Note: This is a simplified version. Real pump.fun integration would require
      // their specific API and bonding curve implementation

      const pumpFunPayload = {
        token_address: tokenResult.mintAddress,
        name: metadata.name,
        symbol: metadata.symbol,
        description: metadata.description,
        image: metadata.image,
        initial_supply: 1000000000, // 1B tokens typical for pump.fun
        bonding_curve: {
          virtual_sol_reserves: 30,
          virtual_token_reserves: 1073000000,
          real_sol_reserves: 0,
          real_token_reserves: 793100000
        }
      };

      // Mock pump.fun deployment (replace with actual API call)
      const response = await this.mockPumpFunDeployment(pumpFunPayload);

      const deployment: PumpFunDeployment = {
        tokenAddress: tokenResult.mintAddress,
        pumpFunUrl: response.url,
        pumpFunId: response.id,
        deployedAt: new Date(),
        initialLiquidity: response.initial_liquidity,
        status: 'deployed'
      };

      // Save deployment record
      await this.redis.setEx(
        `pump_fun_deployment:${tokenResult.mintAddress}`,
        3600 * 24 * 30, // 30 days
        JSON.stringify(deployment)
      );

      console.log(`✅ Deployed to pump.fun: ${deployment.pumpFunUrl}`);
      return deployment;

    } catch (error) {
      console.error('pump.fun deployment failed:', error);

      return {
        tokenAddress: tokenResult.mintAddress,
        pumpFunUrl: '',
        pumpFunId: '',
        deployedAt: new Date(),
        initialLiquidity: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async mockPumpFunDeployment(payload: any): Promise<any> {
    // Mock response - replace with actual pump.fun API integration
    return {
      id: `pump_${Date.now()}`,
      url: `https://pump.fun/${payload.symbol.toLowerCase()}`,
      initial_liquidity: 10,
      status: 'success'
    };
  }

  async getWalletBalance(): Promise<number> {
    try {
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Failed to get wallet balance:', error);
      return 0;
    }
  }

  async estimateTokenCreationCost(): Promise<number> {
    try {
      // Estimate costs for token creation
      const mintRent = await getMinimumBalanceForRentExemptMint(this.connection);
      const estimatedFees = 5000; // 0.000005 SOL for transaction fees

      return (mintRent + estimatedFees) / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Failed to estimate costs:', error);
      return 0.01; // Default estimate
    }
  }

  async getTokenInfo(mintAddress: string): Promise<any> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      const mintInfo = await this.connection.getParsedAccountInfo(mintPubkey);

      return mintInfo.value?.data;
    } catch (error) {
      console.error(`Failed to get token info for ${mintAddress}:`, error);
      return null;
    }
  }

  private async saveTokenRecord(result: TokenCreationResult, request: TokenCreationRequest): Promise<void> {
    const record = {
      ...result,
      tokenSuggestion: request.tokenSuggestion,
      metadata: request.metadata,
      network: this.network
    };

    try {
      // Save detailed record
      await this.redis.setEx(
        `token_created:${result.mintAddress}`,
        3600 * 24 * 30, // 30 days
        JSON.stringify(record)
      );

      // Add to created tokens list
      await this.redis.lPush('created_tokens', result.mintAddress);
      await this.redis.lTrim('created_tokens', 0, 999); // Keep last 1000

      // Add to success tracking
      if (result.status === 'created') {
        await this.redis.zAdd('successful_tokens', {
          score: Date.now(),
          value: result.mintAddress
        });
      }

    } catch (error) {
      console.error('Failed to save token record:', error);
    }
  }

  private async trackCreationMetrics(duration: number, success: boolean, cost: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const metricsKey = `token_metrics:${today}`;

    try {
      await this.redis.multi()
        .hIncrBy(metricsKey, 'total_attempts', 1)
        .hIncrBy(metricsKey, success ? 'successful_creations' : 'failed_creations', 1)
        .hIncrBy(metricsKey, 'total_duration', duration)
        .hIncrByFloat(metricsKey, 'total_costs', cost)
        .expire(metricsKey, 3600 * 24 * 7) // 7 days
        .exec();
    } catch (error) {
      console.error('Failed to track creation metrics:', error);
    }
  }

  async getWalletConfig(): Promise<SolanaWalletConfig> {
    const balance = await this.getWalletBalance();

    return {
      publicKey: this.wallet.publicKey,
      secretKey: this.wallet.secretKey,
      balance,
      lastUpdated: new Date()
    };
  }

  async checkConnection(): Promise<boolean> {
    try {
      const version = await this.connection.getVersion();
      return !!version;
    } catch (error) {
      console.error('Solana connection check failed:', error);
      return false;
    }
  }
}
