// src/scripts/test-lambda.ts
import { handler } from '../lambda/processQueue';
import dotenv from 'dotenv';

dotenv.config();

async function testLambda() {
    // Test request.json processing
    const requestEvent = {
        Records: [
            {
                messageId: "test-message-1",
                body: JSON.stringify({
                    Records: [
                        {
                            s3: {
                                bucket: {
                                    name: "cd-bucket-new"
                                },
                                object: {
                                    key: "audit/2025-01-26/test-789/request.json"
                                }
                            }
                        }
                    ]
                })
            }
        ]
    };

    // Test response.json processing
    const responseEvent = {
        Records: [
            {
                messageId: "test-message-2",
                body: JSON.stringify({
                    Records: [
                        {
                            s3: {
                                bucket: {
                                    name: "cd-bucket-new"
                                },
                                object: {
                                    key: "audit/2025-01-26/test-789/response.json"
                                }
                            }
                        }
                    ]
                })
            }
        ]
    };

    try {
        console.log('\n--- Testing Request Processing ---\n');
        await handler(requestEvent as any, {} as any);
        
        console.log('\n--- Testing Response Processing ---\n');
        await handler(responseEvent as any, {} as any);
        
        console.log('\nBoth request and response processing completed successfully');
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testLambda().catch(console.error);