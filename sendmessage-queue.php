<?php
$api = "http://43.163.121.178:3001/send-message"; // API kita (bukan langsung ke whatsva)
$callback = "https://webhook.site/df248035-3d86-40c2-ac11-228c4091b81b"; // endpoint asli sebagai callback

// Pesan 1 (delay 5 detik)
$body1 = [
  "instance_key" => "V103EviIU66v",       // dipakai sebagai userId
  "callbackUrl"  => $callback,             // diteruskan oleh worker
  "payload"      => [                      // payload asli untuk endpoint tujuan
    "instance_key" => "V103EviIU66v",
    "jid"          => "0895361034833",
    "message"      => "hello admin 1"
  ],
  "delaySeconds" => 5                       // tunda eksekusi 5 detik
];

// Pesan 2 (delay 7 detik setelah pesan 1 selesai, karena FIFO + prefetch=1)
$body2 = [
  "instance_key" => "V103EviIU66v",
  "callbackUrl"  => $callback,
  "payload"      => [
    "instance_key" => "V103EviIU66v",
    "jid"          => "0895361034833",
    "message"      => "hello admin 2"
  ],
  "delaySeconds" => 7
];

$headers = [
  "Content-Type: application/json",
  "Accept: application/json"
];

function postJson($url, $data, $headers) {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
  $res = curl_exec($ch);
  if (curl_errno($ch)) { echo "cURL Error: " . curl_error($ch); }
  else { echo "Response: " . $res . PHP_EOL; }
  curl_close($ch);
}

postJson($api, $body1, $headers);
postJson($api, $body2, $headers);