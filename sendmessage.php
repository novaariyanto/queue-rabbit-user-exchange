<?php
$url = "https://whatsva.id/api/sendMessageText";

$data = [
    "instance_key" => "MOixAfMQgT2q",
    "jid" => "0895361034833",
    "message" => "hello admin 2"
];

$headers = [
    "Content-Type: application/json",
    "Accept: application/json"
];

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);

if (curl_errno($ch)) {
    echo "cURL Error: " . curl_error($ch);
} else {
    echo "Response: " . $response;
}

curl_close($ch);
