<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$rawInput = file_get_contents("php://input");
$data = json_decode($rawInput, true);

$id_raw  = $data['id'] ?? $_POST['id'] ?? '';
$uid_raw = $data['rfid_uid'] ?? $data['rfidUid'] ?? $_POST['rfid_uid'] ?? $_POST['rfidUid'] ?? '';

if (!empty($id_raw) || !empty($uid_raw)) {
    $id_clean  = mysqli_real_escape_string($koneksi, trim((string)$id_raw));
    $uid_clean = mysqli_real_escape_string($koneksi, trim((string)$uid_raw));

    if (!empty($id_clean)) {
        $query = "DELETE FROM rfid_buffer WHERE id = '$id_clean'";
    } else {
        $query = "DELETE FROM rfid_buffer WHERE rfid_uid = '$uid_clean'";
    }

    if (mysqli_query($koneksi, $query)) {
        http_response_code(200);
        echo json_encode(["success" => true, "message" => "Kartu buffer berhasil dihapus!"]);
    } else {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
    }
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID riwayat tidak valid"]);
}
?>