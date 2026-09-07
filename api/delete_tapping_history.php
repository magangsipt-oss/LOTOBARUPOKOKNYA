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
$event_ids = array_values(array_filter(array_map('intval', $data['event_ids'] ?? []), function ($value) { return $value > 0; }));

if (!$id || $id < 1) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID riwayat tidak valid"]);
    exit();
}

$delete_ids = count($event_ids) > 0 ? $event_ids : [$id];
$id_list = implode(',', $delete_ids);
$stmt = mysqli_prepare($koneksi, "DELETE FROM tapping_history WHERE id IN ($id_list)");
mysqli_stmt_execute($stmt);

if (mysqli_stmt_affected_rows($stmt) > 0) {
    echo json_encode(["success" => true, "message" => "Satu sesi pengawas dan mekanik berhasil dihapus"]);
} else {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Riwayat tidak ditemukan atau sudah terhapus"]);
}

mysqli_stmt_close($stmt);
?>