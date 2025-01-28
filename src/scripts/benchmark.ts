import autocannon, { Instance, Result } from 'autocannon';
import { v4 as uuid } from 'uuid';

function runBenchmark(): void {
    const instance: Instance = autocannon({
        url: 'http://localhost:3000/api/test',
        connections: 10,
        pipelining: 1,
        duration: 30,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'app-id': 'benchmark-app',
            'workflow-id': 'benchmark-workflow',
            'action': 'create'
        },
        setupClient: (client: any) => {
            const transactionId = uuid();
            client.setHeaders({
                'transaction-id': transactionId
            });
        },
        body: JSON.stringify({
            name: "Test User",
            email: "test@example.com"
        })
    });

    process.once('SIGINT', () => {
        instance.stop();
    });

    autocannon.track(instance, { renderProgressBar: true });

    instance.on('done', (result: Result) => {
        console.log('\nBenchmark Results:');
        console.log('='.repeat(50));
        
        console.log('\nLatency (ms):');
        console.log(`  p95: ${result.latency.p95}`);
        console.log(`  p99: ${result.latency.p99}`);
        console.log(`  avg: ${result.latency.average}`);
        console.log(`  min: ${result.latency.min}`);
        console.log(`  max: ${result.latency.max}`);
        
        console.log('\nRequests/Second:');
        console.log(`  avg: ${result.requests.average}`);
        console.log(`  min: ${result.requests.min}`);
        console.log(`  max: ${result.requests.max}`);
        
        console.log('\nThroughput:');
        console.log(`  avg: ${formatBytes(result.throughput.average)}/sec`);
        console.log(`  min: ${formatBytes(result.throughput.min)}/sec`);
        console.log(`  max: ${formatBytes(result.throughput.max)}/sec`);

        console.log('\nErrors:', result.errors);
        console.log('Timeouts:', result.timeouts);
        console.log('='.repeat(50));
    });
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
    else return (bytes / 1048576).toFixed(2) + ' MB';
}

console.log('Starting benchmark...');
console.log('Press Ctrl+C to stop');

runBenchmark();