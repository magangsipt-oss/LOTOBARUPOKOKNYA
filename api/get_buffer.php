<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Device-Token, Origin, Accept");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

date_default_timezone_set('Asia/Makassar');
error_reporting(0);

require_once "koneksi.php";
if (!isset($koneksi) && isset($mysqli)) { $koneksi = $mysqli; }
if (!isset($koneksi) && isset($conn)) { $koneksi = $conn; }

if (!$koneksi) {
    http_response_code(500);
    echo json_encode([]);
    exit();
}

$query = "SELECT * FROM rfid_buffer ORDER BY id DESC LIMIT 20";
$result = mysqli_query($koneksi, $query);
$buffer = [];

if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $buffer[] = [
            "id"         => (int)$row['id'],
            "id_box"     => $row['id_box'],
            "rfid_uid"   => strtoupper(trim((string)$row['rfid_uid'])),
            "created_at" => $row['created_at']
        ];
    }
}

http_response_code(200);
echo json_encode($buffer);
?>