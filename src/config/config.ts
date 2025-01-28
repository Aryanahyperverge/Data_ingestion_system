// src/config/config.ts
import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// src/config/config.ts
export const config = {
    app:{
      port:process.env.port || 3000
    },
    aws: {
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
        },
        s3: {
            bucketName: process.env.S3_BUCKET_NAME
        },
        sqs: {
            queueUrl: process.env.SQS_QUEUE_URL
        }
    },
    db: {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        port: 5432,
        ssl: {
            rejectUnauthorized: false
        }
    }
};