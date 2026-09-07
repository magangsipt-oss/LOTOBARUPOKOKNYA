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

$id_raw = $data['id'] ?? $_POST['id'] ?? '';
$id_clean = mysqli_real_escape_string($koneksi, trim((string)$id_raw));

if (!empty($id_clean)) {
    $query = "DELETE FROM maintenance_logs WHERE id = '$id_clean'";
    
    if (mysqli_query($koneksi, $query)) {
        if (mysqli_affected_rows($koneksi) > 0) {
            http_response_code(200);
            echo json_encode(["success" => true, "message" => "Arsip riwayat maintenance berhasil dihapus!"]);
        } else {
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "Log ID [$id_clean] tidak ditemukan atau sudah terhapus."]);
        }
    } else {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
    }
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID Log tidak valid atau tidak terbaca!"]);
}
?>