// // src/test-sqs.ts
// import { SQSService } from './services/sqs.service';

// async function testSQSNotification() {
//     const sqsService = new SQSService();
    
//     console.log('Waiting for S3 event notifications...');
    
//     // Poll for messages
//     setInterval(() => {
//         sqsService.receiveMessages();
//     }, 20000); // Check every 20 seconds
// }

// testSQSNotification();