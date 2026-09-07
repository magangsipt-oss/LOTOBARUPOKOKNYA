<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, DELETE, GET, OPTIONS");
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

$raw_input = file_get_contents("php://input");
$data = json_decode($raw_input, true);

$id_target = $data['sid'] ?? $data['id'] ?? $_POST['sid'] ?? $_POST['id'] ?? $_GET['sid'] ?? $_GET['id'] ?? '';
$uid_target = $data['rfidUid'] ?? $data['rfid_uid'] ?? $data['uid'] ?? $_POST['rfidUid'] ?? $_POST['rfid_uid'] ?? '';

$sid_clean = mysqli_real_escape_string($koneksi, trim((string)$id_target));
$uid_clean = mysqli_real_escape_string($koneksi, trim((string)$uid_target));

if (empty($sid_clean) && empty($uid_clean)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID Karyawan (SID) atau RFID UID wajib disertakan!"]);
    exit();
}

// Proteksi Akun Master Admin
if (strtolower($sid_clean) === 'admin') {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "Akun Master Admin utama dilindungi dan tidak boleh dihapus!"]);
    exit();
}

if (!empty($sid_clean)) {
    $query = "DELETE FROM users WHERE sid = '$sid_clean' OR rfid_uid = '$sid_clean'";
} else {
    $query = "DELETE FROM users WHERE rfid_uid = '$uid_clean'";
}

if (mysqli_query($koneksi, $query)) {
    if (mysqli_affected_rows($koneksi) > 0) {
        http_response_code(200);
        echo json_encode(["success" => true, "message" => "Data karyawan berhasil dihapus secara permanen!"]);
    } else {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Data karyawan tidak ditemukan atau sudah terhapus."]);
    }
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
}
?>