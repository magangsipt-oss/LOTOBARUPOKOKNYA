<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Device-Token, Origin, Accept");

// Tangani Preflight OPTIONS request dari browser
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
    echo json_encode(["is_spv" => false, "success" => false, "message" => "DB Error"]);
    exit();
}

$uid_raw = $_GET['uid'] ?? $_POST['uid'] ?? $_REQUEST['uid'] ?? '';

if (empty(trim((string)$uid_raw))) {
    http_response_code(200);
    echo json_encode(["is_spv" => false, "success" => false, "reason" => "UID Kosong"]);
    exit();
}

// Saring string UID dari spasi dan karakter non-alphanumeric
$clean_uid = strtolower(preg_replace('/[^A-Za-z0-9]/', '', (string)$uid_raw));
$clean_uid_esc = mysqli_real_escape_string($koneksi, $clean_uid);

// Kueri Pencarian Toleran untuk UID RFID, SID Karyawan, maupun FP_ID
$query = "SELECT * FROM users WHERE 
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(rfid_uid), ' ', ''), '\r', ''), '\n', ''), ':', ''), '-', '')) = '$clean_uid_esc' OR 
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(sid), ' ', ''), '\r', ''), '\n', ''), ':', ''), '-', '')) = '$clean_uid_esc' OR
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(fp_id), ' ', ''), '\r', ''), '\n', ''), ':', ''), '-', '')) = '$clean_uid_esc'
          LIMIT 1";
          
$result = mysqli_query($koneksi, $query);

if ($result && mysqli_num_rows($result) > 0) {
    $row = mysqli_fetch_assoc($result);
    
    $nama_user = !empty($row['nama']) ? trim((string)$row['nama']) : "Personel";
    $role_raw  = !empty($row['role']) ? strtolower(trim((string)$row['role'])) : '';
    
    // Pengecekan Jabatan Pengawas / Supervisor / Admin
    $is_spv = (strpos($role_raw, 'pengawas') !== false || 
               strpos($role_raw, 'spv') !== false || 
               strpos($role_raw, 'supervisor') !== false || 
               strpos($role_raw, 'k3') !== false || 
               strpos($role_raw, 'admin') !== false);

    // Penentuan String Role Bersih (Mendukung Fuelman)
    $role_clean = "MEKANIK";
    if ($is_spv) {
        $role_clean = "PENGAWAS";
    } elseif (strpos($role_raw, 'fuel') !== false || strpos($role_raw, 'bbm') !== false) {
        $role_clean = "FUELMAN";
    }

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "is_spv" => $is_spv,
        "uid"    => strtoupper($clean_uid),
        "sid"    => strtoupper(trim((string)($row['sid'] ?? ''))),
        "nama"   => $nama_user,
        "role"   => $role_clean
    ]);
} else {
    http_response_code(200);
    echo json_encode([
        "success" => false,
        "is_spv" => false,
        "nama"   => "UNKNOWN",
        "role"   => "MEKANIK"
    ]);
}
?>