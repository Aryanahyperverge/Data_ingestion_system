// src/services/s3.service.ts
import AWS from 'aws-sdk';
import { config } from '../config/config';

export class S3Service {
    private s3: AWS.S3;
    private uploadQueue: Array<{
        data: any;
        key: string;
        resolve: (value: string) => void;
        reject: (error: any) => void;
    }> = [];
    private isProcessing: boolean = false;
    private batchSize: number = 10;
    private batchTimeout: number = 100;

    constructor() {
        this.s3 = new AWS.S3({
            region: config.aws.region,
            credentials: {
                accessKeyId: config.aws.credentials.accessKeyId!,
                secretAccessKey: config.aws.credentials.secretAccessKey!
            },
            httpOptions: {
                timeout: 5000,
                connectTimeout: 5000
            },
            maxRetries: 3
        });
    }

    async uploadToS3(data: any, transactionId: string, type: 'request' | 'response'): Promise<string> {
        const timestamp = new Date().toISOString().split('T')[0];
        const key = `audit/${timestamp}/${transactionId}/${type}.json`;

        return new Promise((resolve, reject) => {
            this.uploadQueue.push({
                data,
                key,
                resolve,
                reject
            });

            if (!this.isProcessing) {
                this.processBatch();
            }
        });
    }

    async uploadFile(file: Express.Multer.File, transactionId: string): Promise<string> {
        const timestamp = new Date().toISOString().split('T')[0];
        const key = `audit/${timestamp}/${transactionId}/files/${file.originalname}`;

        try {
            await this.s3.putObject({
                Bucket: config.aws.s3.bucketName!,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype
            }).promise();

            return key;
        } catch (error) {
            console.error('Error uploading file:', error);
            throw error;
        }
    }

    private async processBatch() {
        if (this.isProcessing || this.uploadQueue.length === 0) return;

        this.isProcessing = true;

        try {
            while (this.uploadQueue.length > 0) {
                const batch = this.uploadQueue.splice(0, this.batchSize);
                
                const uploadPromises = batch.map(({ data, key, resolve, reject }) => {
                    return this.s3.putObject({
                        Bucket: config.aws.s3.bucketName!,
                        Key: key,
                        Body: JSON.stringify(data),
                        ContentType: 'application/json'
                    }).promise()
                    .then(() => {
                        resolve(key);
                        return key;
                    })
                    .catch(error => {
                        reject(error);
                        throw error;
                    });
                });

                await Promise.all(uploadPromises);

                if (this.uploadQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.batchTimeout));
                }
            }
        } catch (error) {
            console.error('Batch processing error:', error);
        } finally {
            this.isProcessing = false;
        }
    }
}