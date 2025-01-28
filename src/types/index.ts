export interface AuditSearchFilters {
    transactionId?: string;
    appId?: string;
    endpoint?: string;
    statusCode?: number;
    workflowId?: string;
}

export interface AuditRecord {
    transaction_id: string;
    app_id: string;
    endpoint: string;
    status_code: number;
    workflow_id: string;
    action: string;
    timestamp: Date;
    request_s3_key: string;
    response_s3_key: string;
}