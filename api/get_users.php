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

$uid  = isset($_GET['uid']) ? mysqli_real_escape_string($koneksi, trim((string)$_GET['uid'])) : '';
$role = isset($_GET['role']) ? mysqli_real_escape_string($koneksi, trim((string)$_GET['role'])) : '';

$query = "SELECT sid, nama, role, rfid_uid, fp_id, password, foto, created_at FROM users WHERE 1=1";

if (!empty($uid)) {
    $query .= " AND (rfid_uid = '$uid' OR sid = '$uid' OR fp_id = '$uid')";
}

if (!empty($role)) {
    $query .= " AND role = '$role'";
}

$query .= " ORDER BY sid ASC";

$result = mysqli_query($koneksi, $query);
$users = [];

if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $storedPhoto = trim((string)($row['foto'] ?? ''));
        $photo = ($storedPhoto !== '' && strpos($storedPhoto, 'data:image/') === 0)
            ? 'api/get_user_photo.php?uid=' . rawurlencode($row['sid'])
            : $storedPhoto;
        $users[] = [
            "id"         => $row['sid'],
            "sid"        => $row['sid'],
            "uid"        => $row['rfid_uid'] ?? '',
            "rfid_uid"   => $row['rfid_uid'] ?? '',
            "rfidUid"    => $row['rfid_uid'] ?? '',
            "nama"       => $row['nama'],
            "role"       => $row['role'],
            "password"   => $row['password'],
            "foto"       => $photo,
            "foto_url"   => $photo,
            "fp_id"      => $row['fp_id'],
            "created_at" => $row['created_at']
        ];
    }
}

http_response_code(200);
echo json_encode($users);
?>