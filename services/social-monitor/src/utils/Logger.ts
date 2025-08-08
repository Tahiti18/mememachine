import winston from 'winston';
import { LogLevel, LogMessage } from '../types';

/**
 * Enhanced Logger with structured logging for cost tracking
 */
export class Logger {
  private static instance: winston.Logger;

  static {
    this.instance = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { 
        service: 'social-monitor',
        version: '1.0.0'
      },
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
      ],
    });

    if (process.env.NODE_ENV !== 'production') {
      this.instance.add(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }
  }

  static error(message: string, metadata?: any): void {
    this.instance.error(message, metadata);
  }

  static warn(message: string, metadata?: any): void {
    this.instance.warn(message, metadata);
  }

  static info(message: string, metadata?: any): void {
    this.instance.info(message, metadata);
  }

  static debug(message: string, metadata?: any): void {
    this.instance.debug(message, metadata);
  }

  static logCost(provider: string, cost: number, operation: string): void {
    this.info('💰 API Cost Tracked', {
      provider,
      cost,
      operation,
      timestamp: new Date().toISOString()
    });
  }
}