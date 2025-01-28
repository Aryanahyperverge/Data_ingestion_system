// src/scripts/test-connection.ts
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: 5432,
        database: 'postgres',
        ssl: {
            rejectUnauthorized: false
        },
        // Add connection timeout
        connectionTimeoutMillis: 5000,
    };

    console.log('Attempting to connect with config:', {
        host: config.host,
        user: config.user,
        database: config.database
    });

    const client = new Client(config);

    try {
        await client.connect();
        console.log('Successfully connected to database');
        
        const result = await client.query('SELECT NOW()');
        console.log('Query result:', result.rows[0]);
        
    } catch (error) {
        console.error('Connection error:', error);
    } finally {
        await client.end();
    }
}

testConnection();