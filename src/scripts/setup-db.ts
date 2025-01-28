// src/scripts/setup-db.ts
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function setupDatabase() {
    // First connect to default postgres database
    const client = new Client({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: 5432,
        database: 'postgres', // Connect to default database
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('Connected to postgres database');

        // Create new database
        try {
            await client.query('CREATE DATABASE audit_db');
            console.log('audit_db database created successfully');
        } catch (error: any) {
            if (error.code === '42P04') {
                console.log('Database audit_db already exists');
            } else {
                throw error;
            }
        }

        // Close connection to postgres database
        await client.end();

        // Connect to new database
        const auditClient = new Client({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            port: 5432,
            database: 'audit_db',
            ssl: {
                rejectUnauthorized: false
            }
        });

        await auditClient.connect();
        console.log('Connected to audit_db database');

        // Create table
        await auditClient.query(`
            CREATE TABLE IF NOT EXISTS api_audit (
                id BIGSERIAL PRIMARY KEY,
                transaction_id VARCHAR(255) NOT NULL,
                app_id VARCHAR(255),
                endpoint VARCHAR(255),
                status_code INT,
                workflow_id VARCHAR(255),
                action VARCHAR(255),
                timestamp TIMESTAMP,
                request_s3_key VARCHAR(512),
                response_s3_key VARCHAR(512)
            );
        `);
        console.log('api_audit table created successfully');

        // Create indexes
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_transaction_id ON api_audit(transaction_id)',
            'CREATE INDEX IF NOT EXISTS idx_app_id ON api_audit(app_id)',
            'CREATE INDEX IF NOT EXISTS idx_endpoint ON api_audit(endpoint)',
            'CREATE INDEX IF NOT EXISTS idx_workflow_id ON api_audit(workflow_id)',
            'CREATE INDEX IF NOT EXISTS idx_timestamp ON api_audit(timestamp)'
        ];

        for (const indexQuery of indexes) {
            await auditClient.query(indexQuery);
        }
        console.log('Indexes created successfully');

        await auditClient.end();
        console.log('Database setup completed successfully');

    } catch (error) {
        console.error('Error setting up database:', error);
    }
}

// Run the setup
setupDatabase().catch(console.error);