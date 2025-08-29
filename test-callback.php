<?php
// test-callback.php
// Script untuk menguji apakah callback URL responsif

$callbackUrl = "https://whatsva.id/api/sendMessageText";
$testPayload = [
    "instance_key" => "MOixAfMQgT2q",
    "jid" => "0895361034833",
    "message" => "test connection"
];

$headers = [
    "Content-Type: application/json",
    "Accept: application/json"
];

function testCallback($url, $data, $headers) {
    $startTime = microtime(true);
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_TIMEOUT, 10); // 10 second timeout
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5); // 5 second connect timeout
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    $endTime = microtime(true);
    
    curl_close($ch);
    
    $responseTime = round(($endTime - $startTime) * 1000, 2); // in milliseconds
    
    echo "=== CALLBACK TEST RESULT ===\n";
    echo "URL: $url\n";
    echo "Response Time: {$responseTime}ms\n";
    echo "HTTP Code: $httpCode\n";
    
    if ($error) {
        echo "cURL Error: $error\n";
        echo "Status: FAILED\n";
    } else {
        echo "Response: $response\n";
        echo "Status: " . ($httpCode >= 200 && $httpCode < 300 ? "SUCCESS" : "FAILED") . "\n";
    }
    
    if ($responseTime > 5000) {
        echo "WARNING: Response time > 5 seconds, this may cause queue retries!\n";
    }
    
    echo "============================\n\n";
}

echo "Testing callback URL responsiveness...\n\n";

// Test multiple times to check consistency
for ($i = 1; $i <= 3; $i++) {
    echo "Test #$i:\n";
    testCallback($callbackUrl, $testPayload, $headers);
    if ($i < 3) sleep(2); // Wait 2 seconds between tests
}

echo "Test completed. If you see timeouts or errors, this explains why your 100 messages became 150!\n";
echo "Solution: Fix the callback URL or disable retry for affected queues.\n";
?>
