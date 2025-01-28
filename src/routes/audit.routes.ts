import { Router } from 'express';
import { AuditService } from '../services/audit.services';
import { AuditSearchFilters } from '../types';

const router = Router();
const auditService = new AuditService();

router.get('/search', async (req, res) => {
    try {
        // Extract filters from query parameters
        const filters: AuditSearchFilters = {
            transactionId: req.query.transactionId as string,
            appId: req.query.appId as string,
            endpoint: req.query.endpoint as string,
            statusCode: req.query.statusCode ? parseInt(req.query.statusCode as string) : undefined,
            workflowId: req.query.workflowId as string
        };

        // Remove undefined filters
        Object.keys(filters).forEach(key => {
            const filterKey = key as keyof AuditSearchFilters;
            filters[filterKey] === undefined && delete filters[filterKey];
        });

        console.log('Searching with filters:', filters);

        const results = await auditService.searchAuditData(filters);

        // Optionally fetch S3 data if requested
        if (req.query.fetchDetails === 'true' && results.length > 0) {
            const detailedResults = await Promise.all(
                results.map(async (record) => {
                    const [requestData, responseData] = await Promise.all([
                        record.request_s3_key ? auditService.getS3Data(record.request_s3_key) : null,
                        record.response_s3_key ? auditService.getS3Data(record.response_s3_key) : null
                    ]);

                    return {
                        ...record,
                        requestData,
                        responseData
                    };
                })
            );

            return res.json({
                count: detailedResults.length,
                data: detailedResults
            });
        }

        res.json({
            count: results.length,
            data: results
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: (error instanceof Error) ? error.message : 'Unknown error'
        });
    }
});

export default router;