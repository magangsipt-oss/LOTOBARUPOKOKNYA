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

$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
$query = "SELECT * FROM refueling_logs ORDER BY id DESC LIMIT $limit";
$result = mysqli_query($koneksi, $query);
$data = [];

if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $data[] = [
            "id"               => (int)$row['id'],
            "id_box"           => $row['id_box'],
            "fuelman_uid"      => $row['fuelman_uid'],
            "fuelman_name"     => !empty($row['fuelman_name']) ? $row['fuelman_name'] : 'Fuelman',
            "start_time"       => $row['start_time'],
            "end_time"         => $row['end_time'],
            "duration_seconds" => (int)$row['duration_seconds'],
            "latitude"         => $row['latitude'] !== null ? (float)$row['latitude'] : null,
            "longitude"        => $row['longitude'] !== null ? (float)$row['longitude'] : null,
            "is_loto_active"   => (int)$row['is_loto_active']
        ];
    }
}

http_response_code(200);
echo json_encode($data);
?>