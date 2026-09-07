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
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database"]);
    exit();
}

$uid_raw = $_GET['uid'] ?? $_POST['uid'] ?? $_REQUEST['uid'] ?? '';

if (!empty($uid_raw)) {
    $clean_uid = strtolower(preg_replace('/[^A-Za-z0-9]/', '', (string)$uid_raw));
    $clean_uid_esc = mysqli_real_escape_string($koneksi, $clean_uid);
    
    // Kueri toleran: cari berdasarkan rfid_uid, sid, atau fp_id
    $query = "SELECT * FROM users WHERE 
              LOWER(TRIM(REPLACE(REPLACE(REPLACE(rfid_uid, ' ', ''), '\r', ''), '\n', ''))) = '$clean_uid_esc' OR 
              LOWER(TRIM(REPLACE(REPLACE(REPLACE(sid, ' ', ''), '\r', ''), '\n', ''))) = '$clean_uid_esc' OR
              LOWER(TRIM(REPLACE(REPLACE(REPLACE(fp_id, ' ', ''), '\r', ''), '\n', ''))) = '$clean_uid_esc'
              LIMIT 1";
              
    $result = mysqli_query($koneksi, $query);

    if ($result && mysqli_num_rows($result) > 0) {
        $row = mysqli_fetch_assoc($result);
        $role_lower = strtolower(trim((string)$row['role']));
        
        $is_spv = (strpos($role_lower, 'pengawas') !== false || 
                   strpos($role_lower, 'spv') !== false || 
                   strpos($role_lower, 'supervisor') !== false || 
                   strpos($role_lower, 'k3') !== false || 
                   strpos($role_lower, 'admin') !== false);
        
        $role_clean = "MEKANIK";
        if ($is_spv) {
            $role_clean = "PENGAWAS";
        } elseif (strpos($role_lower, 'fuel') !== false || strpos($role_lower, 'bbm') !== false) {
            $role_clean = "FUELMAN";
        }

        echo json_encode([
            "success" => true,
            "uid"    => strtoupper($clean_uid),
            "nama"   => !empty($row['nama']) ? trim((string)$row['nama']) : "Karyawan",
            "role"   => $role_clean,
            "is_spv" => $is_spv
        ]);
        exit();
    }
}

echo json_encode([
    "success" => false, 
    "is_spv" => false, 
    "nama"   => "UNKNOWN", 
    "role"   => "MEKANIK"
]);
?>