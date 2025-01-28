import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';
import pg from 'pg';
// Constants for configuration
const BATCH_SIZE = 100;  // Maximum number of records to process in a single batch
const MAX_RETRIES = 3;   // Maximum number of retries for failed operations
// Initialize clients
const { Client } = pg;
const s3Client = new S3Client();
const cloudwatch = new CloudWatch();
// Database configuration
const dbConfig = {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME || 'audit_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: 5432,
    ssl: {
        rejectUnauthorized: false
    }
};
export const handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));
    console.log('Environment variables:', {
        DB_HOST: process.env.DB_HOST,
        DB_NAME: process.env.DB_NAME,
        DB_USER: process.env.DB_USER
    });
    const client = new Client(dbConfig);
    let currentBatch = {
        requests: [],
        responses: []
    };
    const failedRecords = [];
    const startTime = Date.now();
    try {
        await client.connect();
        console.log('Successfully connected to database');
        // Process records in batches
        for (let i = 0; i < event.Records.length; i++) {
            const record = event.Records[i];
            try {
                const processedRecord = await processRecord(record);
                if (processedRecord.isRequest) {
                    currentBatch.requests.push(processedRecord.data);
                } else {
                    currentBatch.responses.push(processedRecord.data);
                }
                // Process batch if size limit reached or last record
                if (shouldProcessBatch(currentBatch, i, event.Records.length)) {
                    await processBatch(client, currentBatch);
                    await recordMetrics('BatchProcessed', currentBatch);
                    currentBatch = { requests: [], responses: [] }; // Reset batch
                }
            } catch (error) {
                console.error('Error processing record:', {
                    messageId: record.messageId,
                    error: error.message,
                    stack: error.stack
                });
                failedRecords.push({
                    messageId: record.messageId,
                    error: error.message
                });
                await recordMetrics('FailedRecords', 1);
            }
        }
        // Process any remaining records in the final batch
        if (currentBatch.requests.length > 0 || currentBatch.responses.length > 0) {
            await processBatch(client, currentBatch);
            await recordMetrics('BatchProcessed', currentBatch);
        }
        const processingTime = Date.now() - startTime;
        await recordMetrics('ProcessingTime', processingTime);
        // Handle failed records
        if (failedRecords.length > 0) {
            console.warn(`${failedRecords.length} records failed processing:`, failedRecords);
            // Optionally send to DLQ or notification system
        }
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Processing complete',
                totalProcessed: event.Records.length,
                failedCount: failedRecords.length,
                processingTimeMs: processingTime
            })
        };
    } catch (error) {
        console.error('Lambda execution error:', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
};
async function processRecord(record) {
    console.log('Processing record:', record.messageId);
    const body = JSON.parse(record.body);
    if (!body.Records?.[0]) {
        throw new Error('Invalid record format: No S3 record found');
    }
    const s3Record = body.Records[0];
    const command = new GetObjectCommand({
        Bucket: s3Record.s3.bucket.name,
        Key: s3Record.s3.object.key
    });
    const response = await s3Client.send(command);
    const data = JSON.parse(await response.Body.transformToString());
    const isRequest = s3Record.s3.object.key.includes('request.json');
    return {
        isRequest,
        data: isRequest ? {
            transactionId: data.transactionId,
            appId: data.appId,
            endpoint: data.url,
            workflowId: data.workflowId,
            action: data.action,
            timestamp: new Date(data.timestamp),
            requestS3Key: s3Record.s3.object.key
        } : {
            transactionId: data.transactionId,
            statusCode: data.statusCode,
            responseS3Key: s3Record.s3.object.key
        }
    };
}
async function processBatch(client, batch) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            await client.query('BEGIN');
            if (batch.requests.length > 0) {
                const requestChunks = chunkArray(batch.requests, BATCH_SIZE);
                for (const chunk of requestChunks) {
                    await insertRequestDataBatch(client, chunk);
                }
            }
            if (batch.responses.length > 0) {
                const responseChunks = chunkArray(batch.responses, BATCH_SIZE);
                for (const chunk of responseChunks) {
                    await updateResponseDataBatch(client, chunk);
                }
            }
            await client.query('COMMIT');
            console.log(`Batch processed successfully: ${batch.requests.length} requests, ${batch.responses.length} responses`);
            return;
        } catch (error) {
            await client.query('ROLLBACK');
            retries++;
            if (retries === MAX_RETRIES) {
                throw new Error(`Failed to process batch after ${MAX_RETRIES} attempts: ${error.message}`);
            }
            console.warn(`Batch processing attempt ${retries} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff
        }
    }
}
async function insertRequestDataBatch(client, dataBatch) {
    console.log('Inserting request data batch:', dataBatch);
    const values = [];
    const placeholders = [];
    dataBatch.forEach((data, index) => {
        const idx = index * 7;
        values.push(
            data.transactionId,
            data.appId,
            data.endpoint,
            data.workflowId,
            data.action,
            data.timestamp,
            data.requestS3Key
        );
        placeholders.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`);
    });
    const query = `
        INSERT INTO api_audit (
            transaction_id,
            app_id,
            endpoint,
            workflow_id,
            action,
            timestamp,
            request_s3_key
        ) VALUES
        ${placeholders.join(',')}
    `;
    try {
        await client.query(query, values);
        console.log('Batch insert query executed successfully');
    } catch (error) {
        console.error('Error inserting request data batch:', error);
        throw error;
    }
}
async function updateResponseDataBatch(client, dataBatch) {
    console.log('Updating response data batch:', dataBatch);
    const tempTableName = `temp_response_data_${Date.now()}`;
    try {
        await client.query(`
            CREATE TEMP TABLE ${tempTableName} (
                transaction_id VARCHAR(255),
                status_code INTEGER,
                response_s3_key VARCHAR(1024)
            ) ON COMMIT DROP
        `);
        const values = [];
        const placeholders = [];
        dataBatch.forEach((data, index) => {
            const idx = index * 3;
            values.push(
                data.transactionId,
                data.statusCode,
                data.responseS3Key
            );
            placeholders.push(`($${idx + 1}, $${idx + 2}, $${idx + 3})`);
        });
        const insertTempQuery = `
            INSERT INTO ${tempTableName} (
                transaction_id,
                status_code,
                response_s3_key
            ) VALUES
            ${placeholders.join(',')}
        `;
        await client.query(insertTempQuery, values);
        const updateQuery = `
            UPDATE api_audit AS a
            SET
                status_code = temp.status_code,
                response_s3_key = temp.response_s3_key
            FROM ${tempTableName} temp
            WHERE a.transaction_id = temp.transaction_id
        `;
        await client.query(updateQuery);
        console.log('Batch update query executed successfully');
    } catch (error) {
        console.error('Error updating response data batch:', error);
        throw error;
    }
}
function shouldProcessBatch(batch, currentIndex, totalRecords) {
    const batchSize = batch.requests.length + batch.responses.length;
    return batchSize >= BATCH_SIZE || currentIndex === totalRecords - 1;
}
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
async function recordMetrics(metricName, data) {
    try {
        const metrics = [];
        if (metricName === 'BatchProcessed') {
            metrics.push({
                MetricName: 'RequestsProcessed',
                Value: data.requests.length,
                Unit: 'Count'
            });
            metrics.push({
                MetricName: 'ResponsesProcessed',
                Value: data.responses.length,
                Unit: 'Count'
            });
        } else if (metricName === 'FailedRecords') {
            metrics.push({
                MetricName: 'FailedRecords',
                Value: data,
                Unit: 'Count'
            });
        } else if (metricName === 'ProcessingTime') {
            metrics.push({
                MetricName: 'ProcessingTime',
                Value: data,
                Unit: 'Milliseconds'
            });
        }
        if (metrics.length > 0) {
            await cloudwatch.putMetricData({
                Namespace: 'APIAudit',
                MetricData: metrics
            });
        }
    } catch (error) {
        console.error('Error recording metrics:', error);
        // Don't throw the error as metrics are non-critical
    }
}
