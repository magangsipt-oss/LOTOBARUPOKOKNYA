<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Device-Token");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

require_once "koneksi.php";
if (!isset($koneksi) && isset($mysqli)) { $koneksi = $mysqli; }
if (!isset($koneksi) && isset($conn)) { $koneksi = $conn; }

if (!$koneksi) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$data = json_decode(file_get_contents("php://input"), true);
$id = filter_var($data['id'] ?? $_POST['id'] ?? null, FILTER_VALIDATE_INT);

if (!$id || $id < 1) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID log tidak valid"]);
    exit();
}

$stmt = mysqli_prepare($koneksi, "DELETE FROM audit_logs WHERE id = ?");
mysqli_stmt_bind_param($stmt, "i", $id);
mysqli_stmt_execute($stmt);

if (mysqli_stmt_affected_rows($stmt) > 0) {
    echo json_encode(["success" => true, "message" => "Log aktivitas berhasil dihapus"]);
} else {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Log tidak ditemukan atau sudah terhapus"]);
}

mysqli_stmt_close($stmt);
?>