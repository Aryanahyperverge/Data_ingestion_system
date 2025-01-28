// src/lambda/processQueue.ts
import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { S3 } from 'aws-sdk';
import { Client } from 'pg';

const s3 = new S3();

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

export const handler = async (event: SQSEvent, context: Context) => {
    console.log('Event received:', JSON.stringify(event, null, 2));
    console.log('Environment variables:', {
        DB_HOST: process.env.DB_HOST,
        DB_NAME: process.env.DB_NAME,
        DB_USER: process.env.DB_USER
    });

    const client = new Client({
        host: process.env.DB_HOST,
        database: process.env.DB_NAME || 'audit_db',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: 5432,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Test DB Connection
        console.log('Attempting database connection...');
        await client.connect();
        console.log('Successfully connected to database');

        for (const record of event.Records) {
            try {
                console.log('Processing record:', record.messageId);
                const body = JSON.parse(record.body);
                console.log('Parsed message body:', body);

                const s3Record = body.Records[0];
                console.log('S3 Record:', s3Record);

                // Get S3 data
                const s3Data = await s3.getObject({
                    Bucket: s3Record.s3.bucket.name,
                    Key: s3Record.s3.object.key
                }).promise();
                console.log('Retrieved S3 data successfully');

                const data = JSON.parse(s3Data.Body!.toString());
                console.log('Parsed S3 data:', data);

                const isRequest = s3Record.s3.object.key.includes('request.json');
                console.log('Processing as:', isRequest ? 'request' : 'response');

                if (isRequest) {
                    await insertRequestData(client, {
                        transactionId: data.transactionId,
                        appId: data.appId,
                        endpoint: data.url,
                        workflowId: data.workflowId,
                        action: data.action,
                        timestamp: new Date(data.timestamp),
                        requestS3Key: s3Record.s3.object.key
                    });
                    console.log('Request data inserted successfully');
                } else {
                    await updateResponseData(client, {
                        transactionId: data.transactionId,
                        statusCode: data.statusCode,
                        responseS3Key: s3Record.s3.object.key
                    });
                    console.log('Response data updated successfully');
                }
            } catch (error) {
                console.error('Error processing record:', {
                    messageId: record.messageId,
                    error: (error as any).message,
                    stack: (error as any).stack
                });
                throw error;
            }
        }
    } catch (error) {
        console.error('Lambda execution error:', {
            error: (error as any).message,
            stack: (error as any).stack
        });
        throw error;
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
};

async function insertRequestData(client: Client, data: any) {
    console.log('Inserting request data:', data);
    const query = `
        INSERT INTO api_audit (
            transaction_id, 
            app_id, 
            endpoint, 
            workflow_id, 
            action, 
            timestamp, 
            request_s3_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    try {
        await client.query(query, [
            data.transactionId,
            data.appId,
            data.endpoint,
            data.workflowId,
            data.action,
            data.timestamp,
            data.requestS3Key
        ]);
        console.log('Insert query executed successfully');
    } catch (error) {
        console.error('Error inserting request data:', error);
        throw error;
    }
}

async function updateResponseData(client: Client, data: any) {
    console.log('Updating response data:', data);
    const query = `
        UPDATE api_audit 
        SET status_code = $1, 
            response_s3_key = $2
        WHERE transaction_id = $3
    `;

    try {
        await client.query(query, [
            data.statusCode,
            data.responseS3Key,
            data.transactionId
        ]);
        console.log('Update query executed successfully');
    } catch (error) {
        console.error('Error updating response data:', error);
        throw error;
    }
}