// src/services/audit.service.ts
import { Pool } from 'pg';
import { S3 } from 'aws-sdk';
import { createClient } from 'redis';
import { config } from '../config/config';
import { AuditSearchFilters, AuditRecord } from '../types';

export class AuditService {
    private s3: S3;
    private pool: Pool;
    private redis: any = null;
    private readonly CACHE_EXPIRY = 300; // 5 minutes

    constructor() {
        // Initialize S3
        this.s3 = new S3({
            region: config.aws.region,
            credentials: config.aws.credentials
        });

        // Initialize connection pool
        this.pool = new Pool({
            ...config.db,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        // Initialize Redis/ElastiCache if configured
        if (process.env.ELASTICACHE_ENDPOINT || process.env.REDIS_URL) {
            this.initializeCache();
        }
    }

    private async initializeCache() {
        try {
            this.redis = createClient({
                url: process.env.ELASTICACHE_ENDPOINT 
                    ? `redis://${process.env.ELASTICACHE_ENDPOINT}:${process.env.REDIS_PORT || 6379}`
                    : process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            return new Error('Redis connection retries exhausted');
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            });

            this.redis.on('error', (error: Error) => {
                console.error('Redis connection error:', error);
                this.redis = null; // Disable cache on error
            });

            this.redis.on('connect', () => {
                console.log('Successfully connected to Redis/ElastiCache');
            });

            await this.redis.connect();
        } catch (error) {
            console.error('Failed to initialize Redis:', error);
            this.redis = null;
        }
    }

    private async getCachedData(key: string): Promise<any | null> {
        if (!this.redis) return null;

        try {
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Cache read error:', error);
            return null;
        }
    }

    private async setCachedData(key: string, data: any): Promise<void> {
        if (!this.redis) return;

        try {
            await this.redis.setEx(key, this.CACHE_EXPIRY, JSON.stringify(data));
        } catch (error) {
            console.error('Cache write error:', error);
        }
    }


    async searchAuditData(filters: AuditSearchFilters): Promise<AuditRecord[]> {
        const startTime = process.hrtime();

        // Try cache first
        const cacheKey = `audit:${JSON.stringify(filters)}`;
        const cachedData = await this.getCachedData(cacheKey);
        
        if (cachedData) {
            console.log('Cache hit');
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds * 1000 + nanoseconds / 1e6;
            console.log(`Search completed (cached) in ${duration.toFixed(2)}ms`);
            return cachedData;
        }

        // Query database if not in cache
        const client = await this.pool.connect();
        
        try {
            let conditions = [];
            let params = [];
            let paramCount = 1;

            if (filters.transactionId) {
                conditions.push(`transaction_id = $${paramCount}`);
                params.push(filters.transactionId);
                paramCount++;
            }

            if (filters.appId) {
                conditions.push(`app_id = $${paramCount}`);
                params.push(filters.appId);
                paramCount++;
            }

            if (filters.endpoint) {
                conditions.push(`endpoint = $${paramCount}`);
                params.push(filters.endpoint);
                paramCount++;
            }

            if (filters.statusCode) {
                conditions.push(`status_code = $${paramCount}`);
                params.push(filters.statusCode);
                paramCount++;
            }

            if (filters.workflowId) {
                conditions.push(`workflow_id = $${paramCount}`);
                params.push(filters.workflowId);
                paramCount++;
            }

            const whereClause = conditions.length > 0 
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            // Optimized query with index hints
            const query = `
                SELECT /*+ INDEX(api_audit idx_timestamp) */
                    transaction_id,
                    app_id,
                    endpoint,
                    status_code,
                    workflow_id,
                    action,
                    timestamp,
                    request_s3_key,
                    response_s3_key
                FROM api_audit 
                ${whereClause}
                ORDER BY timestamp DESC
                LIMIT 100
            `;

            console.log('Executing query:', { query, params });
            const result = await client.query(query, params);

            // Cache the results
            await this.setCachedData(cacheKey, result.rows);

            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds * 1000 + nanoseconds / 1e6;
            console.log(`Search completed (database) in ${duration.toFixed(2)}ms`);

            return result.rows;
        } finally {
            client.release();
        }
    }

    async getS3Data(key: string) {
        const cacheKey = `s3:${key}`;

        // Try cache first
        const cachedData = await this.getCachedData(cacheKey);
        if (cachedData) {
            console.log('S3 data cache hit');
            return cachedData;
        }

        try {
            const response = await this.s3.getObject({
                Bucket: config.aws.s3.bucketName!,
                Key: key
            }).promise();

            const data = JSON.parse(response.Body!.toString());

            // Cache the S3 data
            await this.setCachedData(cacheKey, data);

            return data;
        } catch (error) {
            console.error('Error fetching S3 data:', error);
            throw error;
        }
    }

    // Method to fetch both metadata and S3 data if requested
    async searchAuditDataWithDetails(
        filters: AuditSearchFilters, 
        fetchDetails: boolean = false
    ): Promise<any[]> {
        const results = await this.searchAuditData(filters);

        if (!fetchDetails) {
            return results;
        }

        // Fetch S3 data for each result
        const detailedResults = await Promise.all(
            results.map(async (record) => {
                try {
                    const [requestData, responseData] = await Promise.all([
                        record.request_s3_key ? this.getS3Data(record.request_s3_key) : null,
                        record.response_s3_key ? this.getS3Data(record.response_s3_key) : null
                    ]);

                    return {
                        ...record,
                        requestData,
                        responseData
                    };
                } catch (error) {
                    console.error(`Error fetching S3 data for transaction ${record.transaction_id}:`, error);
                    return record;
                }
            })
        );

        return detailedResults;
    }
}