// src/middleware/audit.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { S3Service } from '../services/s3.service';
import multer from 'multer';


const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
}).any();

export const createAuditMiddleware = (s3Service: S3Service) => {
    return (req: Request, res: Response, next: NextFunction) => {
        upload(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: 'File upload error', message: err.message });
            }

            const startTime = process.hrtime();
            const transactionId = req.headers['transaction-id'] as string;
            
            if (!transactionId) {
                return res.status(400).json({ error: 'transaction-id header is required' });
            }

           
            const files = req.files as Express.Multer.File[];
            const fileKeys: string[] = [];

            if (files && files.length > 0) {
                try {
                    const uploadPromises = files.map(file => 
                        s3Service.uploadFile(file, transactionId)
                    );
                    fileKeys.push(...await Promise.all(uploadPromises));
                } catch (error) {
                    console.error('File upload error:', error);
                }
            }

            // Capture request data
            const requestData = {
                transactionId,
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: req.body,
                query: req.query,
                files: fileKeys.map(key => ({
                    key,
                    originalName: files?.find(f => 
                        key.includes(f.originalname)
                    )?.originalname
                })),
                appId: req.headers['app-id'],
                workflowId: req.headers['workflow-id'],
                action: req.headers['action']
            };

            // Store request data asynchronously
            const requestUploadPromise = s3Service.uploadToS3(requestData, transactionId, 'request')
                .catch(error => console.error('Failed to store request data:', error));

            setImmediate(() => {
                requestUploadPromise.catch(() => {});
            });

            // Override send method to capture response
            const originalSend = res.send;
            res.send = function(body) {
                const responseData = {
                    transactionId,
                    timestamp: new Date().toISOString(),
                    statusCode: res.statusCode,
                    headers: res.getHeaders(),
                    body,
                    appId: req.headers['app-id'],
                    workflowId: req.headers['workflow-id'],
                    action: req.headers['action']
                };

                setImmediate(() => {
                    s3Service.uploadToS3(responseData, transactionId, 'response')
                        .catch(error => console.error('Failed to store response data:', error));
                });

                const [seconds, nanoseconds] = process.hrtime(startTime);
                const duration = seconds * 1000 + nanoseconds / 1e6;
                console.log(`Request processed in ${duration.toFixed(2)}ms`);

                return originalSend.call(this, body);
            };

            next();
        });
    };
};