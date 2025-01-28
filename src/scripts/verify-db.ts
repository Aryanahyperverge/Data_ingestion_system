// src/scripts/verify-db.ts
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function verifySetup() {
    const client = new Client({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'audit_db',
        port: 5432,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('Connected to audit_db');

        // Test insert
        // await client.query(`
        //     INSERT INTO api_audit (
        //         transaction_id, 
        //         app_id, 
        //         endpoint,
        //         status_code,
        //         workflow_id,
        //         action,
        //         timestamp
        //     ) VALUES (
        //         'test-123',
        //         'test-app',
        //         '/api/test',
        //         200,
        //         'test-workflow',
        //         'test',
        //         NOW()
        //     );
        // `);
        // console.log('Test record inserted');

        // Verify record
        const result = await client.query('SELECT * FROM api_audit');
        console.log('Records in table:', result.rows);

    } catch (error) {
        console.error('Verification failed:', error);
    } finally {
        await client.end();
    }
}

verifySetup().catch(console.error);