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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$limit  = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
$id_box = isset($_GET['id_box']) ? mysqli_real_escape_string($koneksi, trim((string)$_GET['id_box'])) : '';

$query = "SELECT a.id, a.id_box, a.event, a.rfid_uid, a.lat, a.lng, a.tanggal,
                 u.nama AS nama_karyawan, u.role AS role_karyawan
          FROM audit_logs a
          LEFT JOIN users u ON (u.rfid_uid = a.rfid_uid OR u.sid = a.rfid_uid)";

if (!empty($id_box)) {
    $query .= " WHERE a.id_box = '$id_box'";
}

$query .= " ORDER BY a.id DESC LIMIT $limit";

$result = mysqli_query($koneksi, $query);
$logs = [];

if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $logs[] = [
            "id"            => (int)$row['id'],
            "id_box"        => $row['id_box'],
            "uid"           => $row['rfid_uid'],
            "nama_karyawan" => !empty($row['nama_karyawan']) ? $row['nama_karyawan'] : 'Personel Belum Terdaftar',
            "role"          => !empty($row['role_karyawan']) ? $row['role_karyawan'] : 'Unknown',
            "event"         => $row['event'],
            "lat"           => (float)$row['lat'],
            "lng"           => (float)$row['lng'],
            "tanggal"       => $row['tanggal']
        ];
    }

    http_response_code(200);
    echo json_encode(["success" => true, "total" => count($logs), "data" => $logs]);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
}
?>