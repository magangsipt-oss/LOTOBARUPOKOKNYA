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
    http_response_code(200);
    echo json_encode([]);
    exit();
}

$query = "SELECT * FROM maintenance_logs ORDER BY id DESC";
$result = mysqli_query($koneksi, $query);

$logs = [];
if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $logs[] = [
            "id"        => (int)$row['id'],
            "waktu"     => $row['waktu'],
            "mesin"     => !empty($row['mesin']) ? $row['mesin'] : $row['id_box'],
            "id_box"    => $row['id_box'],
            "jenis"     => $row['jenis'],
            "estimasi"  => $row['estimasi'],
            "teknisi"   => $row['teknisi'],
            "pengawas"  => !empty($row['pengawas']) ? $row['pengawas'] : '-',
            "deskripsi" => $row['deskripsi'],
            "status"    => $row['status'],
            "foto"      => $row['foto']
        ];
    }
}

http_response_code(200);
echo json_encode($logs);
?>