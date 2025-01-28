// src/app.ts
import express from 'express';
import { createAuditMiddleware } from './middleware/audit.middleware';
import { S3Service } from './services/s3.service';
import { config } from './config/config';
import auditRoutes from './routes/audit.routes';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize S3 service
const s3Service = new S3Service();

app.use('/api/audit', auditRoutes);

// Apply audit middleware to all other routes
const auditMiddleware = createAuditMiddleware(s3Service);
app.use('/api', (req, res, next) => {
    // Skip audit routes
    if (req.path.startsWith('/audit')) {
        return next();
    }
    auditMiddleware(req, res, next);
});

// Test routes
app.post('/api/test', (req, res) => {
    try {
        const testData = {
            message: 'Test successful',
            receivedData: req.body,
            timestamp: new Date().toISOString()
        };

        res.status(200).json(testData);
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            message: (error instanceof Error) ? error.message : 'Unknown error'
        });
    }
});

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

const PORT = config.app.port;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});