<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Device-Token, Origin, Accept");

// Tangani Preflight CORS dari browser
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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database"]);
    exit();
}

$json_input = file_get_contents('php://input');
$data = json_decode($json_input, true);

// Tangkap parameter input secara fleksibel (JSON maupun Form POST)
$id_box_raw = $data['id_box'] ?? $data['id'] ?? $_POST['id_box'] ?? $_POST['id'] ?? '';
$unit_raw   = $data['unit'] ?? $data['nama_alat'] ?? $_POST['unit'] ?? $_POST['nama_alat'] ?? '';
$ip_raw     = $data['ip'] ?? $data['ip_address'] ?? $_POST['ip'] ?? $_POST['ip_address'] ?? '192.168.1.100';
$lat_raw    = $data['lat'] ?? $_POST['lat'] ?? 2.144691;
$lng_raw    = $data['lng'] ?? $data['lon'] ?? $_POST['lng'] ?? $_POST['lon'] ?? 117.477526;

$id_box_clean = trim((string)$id_box_raw);
if (empty($id_box_clean)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID Box wajib diisi!"]);
    exit();
}

$id_box = mysqli_real_escape_string($koneksi, $id_box_clean);
$unit   = !empty(trim((string)$unit_raw)) ? mysqli_real_escape_string($koneksi, trim((string)$unit_raw)) : 'UNIT ' . $id_box;
$ip     = !empty(trim((string)$ip_raw)) ? mysqli_real_escape_string($koneksi, trim((string)$ip_raw)) : '192.168.1.100';

$lat = (is_numeric($lat_raw) && (float)$lat_raw != 0) ? (float)$lat_raw : 2.144691;
$lng = (is_numeric($lng_raw) && (float)$lng_raw != 0) ? (float)$lng_raw : 117.477526;

$waktu_sekarang = date('Y-m-d H:i:s');

// Kueri INSERT dengan ON DUPLICATE KEY UPDATE agar aman dari duplikasi ID
$query = "INSERT INTO boxes (
            id_box, unit, ip, ssid, lat, lng, state, lcd0, lcd1,
            relay_open, supervisor_uid, active_fuelman, last_event, last_uid,
            is_online, last_ping
          ) VALUES (
            '$id_box', '$unit', '$ip', 'Wi-Fi Hotspot', $lat, $lng, 'STATE_IDLE', '  SISTEM READY', 'TEKAN 1 UTK MULAI',
            0, '—', '', 'REG_BOX', 'SYSTEM',
            1, '$waktu_sekarang'
          )
          ON DUPLICATE KEY UPDATE 
            unit = '$unit',
            ip = '$ip',
            lat = $lat,
            lng = $lng,
            last_ping = '$waktu_sekarang'";

if (mysqli_query($koneksi, $query)) {
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Unit boks [$id_box] berhasil disimpan ke database!"
    ]);
} else {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "MySQL Error: " . mysqli_error($koneksi)
    ]);
}
?>