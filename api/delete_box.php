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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database"]);
    exit();
}

$raw_input = file_get_contents("php://input");
$data = json_decode($raw_input, true);

$id_target = $data['id_box'] ?? $data['id'] ?? $_POST['id_box'] ?? $_POST['id'] ?? '';
$id_clean  = mysqli_real_escape_string($koneksi, trim((string)$id_target));

if (!empty($id_clean)) {
    // 1. Hapus entitas box dari tabel boxes
    $query = "DELETE FROM boxes WHERE id_box = '$id_clean'";
    
    if (mysqli_query($koneksi, $query)) {
        if (mysqli_affected_rows($koneksi) > 0) {
            // 2. Bersihkan sisa antrean jika boks memiliki antrean gembok aktif
            @mysqli_query($koneksi, "DELETE FROM queue WHERE id_box = '$id_clean'");
            
            http_response_code(200);
            echo json_encode([
                "success"  => true, 
                "message" => "Unit boks [$id_clean] berhasil dihapus secara permanen!"
            ]);
        } else {
            http_response_code(404);
            echo json_encode([
                "success"  => false, 
                "message" => "Gagal: ID [$id_clean] tidak ditemukan di database!"
            ]);
        }
    } else {
        http_response_code(500);
        echo json_encode([
            "success"  => false, 
            "message" => "MySQL Error: " . mysqli_error($koneksi)
        ]);
    }
} else {
    http_response_code(400);
    echo json_encode([
        "success"  => false, 
        "message" => "Parameter ID boks tidak terbaca atau kosong!"
    ]);
}
?>