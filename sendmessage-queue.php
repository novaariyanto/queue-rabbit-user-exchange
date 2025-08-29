<?php
$api = "http://43.163.121.178:3001/send-message"; // API kita (bukan langsung ke whatsva)
$callback = "https://whatsva.id/api/sendMessageText"; // endpoint asli sebagai callback

// Pesan 1 (delay 5 detik)
$body1 = [
  "userId" => "user1",       // dipakai sebagai userId
  "callbackUrl"  => $callback,             // diteruskan oleh worker
  "payload"      => [                      // payload asli untuk endpoint tujuan
    "instance_key" => "MOixAfMQgT2q",
    "jid"          => "0895361034833",
    "message"      => "hello 2 seconds"
  ],
  "delaySeconds" => 2                       // tunda eksekusi 5 detik
];

// Pesan 2 (delay 7 detik setelah pesan 1 selesai, karena FIFO + prefetch=1)
$body2 = [
  "userId" => "user2",
  "callbackUrl"  => $callback,
  "payload"      => [
    "instance_key" => "MOixAfMQgT2q",
    "jid"          => "0895361034833",
    "message"      => "hello 5 seconds"
  ],
  "delaySeconds" => 5
];

$headers = [
  "Content-Type: application/json",
  "Accept: application/json"
];

function postJson($url, $data, $headers,$i=1) {
    $data["userId"] = "user".$i;
   
    if($i % 2 == 1){
      $data["delaySeconds"] =  $data["delaySeconds"]+1;
    }
    $data["payload"]["message"] = "message ".$i." user".$i." delay ".$data["delaySeconds"];
  
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

for ($i = 0; $i < 1000; $i++) {
  for ($j = 0; $j < 1; $j++) {
    postJson($api, $body1, $headers,$i);
  }
}