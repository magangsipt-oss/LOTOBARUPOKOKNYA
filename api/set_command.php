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

require_once 'koneksi.php';
if (!isset($koneksi) && isset($mysqli)) { $koneksi = $mysqli; }
if (!isset($koneksi) && isset($conn)) { $koneksi = $conn; }

if (!$koneksi) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$raw_input = file_get_contents("php://input");
$data = json_decode($raw_input, true);

$box_id_raw = $data['box_id'] ?? $data['id_box'] ?? $data['id'] ?? $_POST['box_id'] ?? $_POST['id_box'] ?? '';
$cmd_raw    = $data['cmd'] ?? $data['command'] ?? $_POST['cmd'] ?? $_POST['command'] ?? '';
$param_raw  = $data['param'] ?? $_POST['param'] ?? '';

$box_id = mysqli_real_escape_string($koneksi, trim((string)$box_id_raw));
$cmd    = mysqli_real_escape_string($koneksi, trim((string)$cmd_raw));
$param  = mysqli_real_escape_string($koneksi, trim((string)$param_raw));

if (!empty($box_id) && !empty($cmd)) {
    $query = "UPDATE boxes SET pending_cmd = '$cmd', cmd_param = '$param' WHERE id_box = '$box_id'";

    if (mysqli_query($koneksi, $query)) {
        http_response_code(200);
        echo json_encode([
            "success"  => true,
            "message" => "Perintah [$cmd] berhasil dikirim ke antrean Boks $box_id!"
        ]);
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
        "message" => "Parameter box_id dan cmd tidak boleh kosong!"
    ]);
}
?>