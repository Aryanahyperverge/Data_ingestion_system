import fetch from 'node-fetch';

async function testSearchAPI() {
    const testCases = [
        { appId: 'test-app' },
        { statusCode: 200 },
        { workflowId: 'registration' },
        { appId: 'test-app', statusCode: 200 },
        { appId: 'test-app', workflowId: 'registration' },
        { transactionId: 'test-789' }
    ];

    for (const testCase of testCases) {
        const params = new URLSearchParams(testCase as any);
        console.log('\nTesting with params:', params.toString());
        
        try {
            const response = await fetch(`http://localhost:3000/api/audit/search?${params}`);
            const data = await response.json();
            console.log('Results:', {
                filters: testCase,
                count: data.count,
                firstRecord: data.data[0]
            });
        } catch (error) {
            console.error('Test failed:', error);
        }
    }
}

testSearchAPI().catch(console.error);