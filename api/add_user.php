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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$rawInput = file_get_contents("php://input");
$data = json_decode($rawInput, true);

$sid_raw  = $data['sid'] ?? $_POST['sid'] ?? '';
$nama_raw = $data['nama'] ?? $data['nama_lengkap'] ?? $_POST['nama'] ?? $_POST['nama_lengkap'] ?? '';
$role_raw = $data['role'] ?? $_POST['role'] ?? 'teknisi';
$rfid_raw = $data['rfidUid'] ?? $data['rfid_uid'] ?? $_POST['rfidUid'] ?? $_POST['rfid_uid'] ?? '';
$pass_raw = $data['password'] ?? $_POST['password'] ?? $sid_raw;
$foto_raw = $data['foto'] ?? $_POST['foto'] ?? '';

function simpanFotoProfil($fotoRaw, $sid, $defaultFoto) {
    $fotoClean = trim((string)$fotoRaw);
    if ($fotoClean === '') {
        return $defaultFoto;
    }

    if (preg_match('/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+\/=\r\n]+)$/', $fotoClean, $matches)) {
        $imageData = base64_decode(str_replace(["\r", "\n"], '', $matches[2]), true);
        if ($imageData !== false && strlen($imageData) <= 5 * 1024 * 1024) {
            // Simpan Data URI langsung di MySQL; tidak membuat file di server.
            return 'data:image/' . ($matches[1] === 'jpg' ? 'jpeg' : $matches[1]) . ';base64,' . str_replace(["\r", "\n"], '', $matches[2]);
        }
        return $defaultFoto;
    }

    return substr($fotoClean, 0, 255);
}

if (!empty(trim((string)$sid_raw)) && !empty(trim((string)$nama_raw))) {
    $sid  = mysqli_real_escape_string($koneksi, trim((string)$sid_raw));
    $nama = mysqli_real_escape_string($koneksi, trim((string)$nama_raw));
    $pass = mysqli_real_escape_string($koneksi, trim((string)$pass_raw));
    $rfid_clean = trim((string)$rfid_raw);
    $foto_clean = simpanFotoProfil($foto_raw, $sid, 'assets/default-avatar.png');
    $foto = mysqli_real_escape_string($koneksi, $foto_clean);

    // 1. Sanitasi Role String
    $role_check = strtolower(trim((string)$role_raw));
    if (strpos($role_check, 'pengawas') !== false || strpos($role_check, 'spv') !== false || strpos($role_check, 'k3') !== false) {
        $role = 'pengawas';
    } else if (strpos($role_check, 'fuel') !== false || strpos($role_check, 'bbm') !== false) {
        $role = 'fuelman';
    } else if (strpos($role_check, 'admin') !== false) {
        $role = 'admin';
    } else {
        $role = 'teknisi'; 
    }

    // 2. Format RFID UID (Gunakan NULL jika kosong agar tidak melanggar Unique Key)
    if (empty($rfid_clean) || $rfid_clean === '-' || $rfid_clean === '—' || strtoupper($rfid_clean) === 'NULL') {
        $rfid_sql = "NULL";
    } else {
        $rfid_sql = "'" . mysqli_real_escape_string($koneksi, strtoupper($rfid_clean)) . "'";
    }

    // 3. Upsert Logic (Mendukung Insert Baru & Edit Akun dari Frontend)
    $cek_user = mysqli_query($koneksi, "SELECT sid FROM users WHERE sid = '$sid' LIMIT 1");

    if ($cek_user && mysqli_num_rows($cek_user) > 0) {
        $query = "UPDATE users SET 
                    nama = '$nama', 
                    role = '$role', 
                    rfid_uid = $rfid_sql, 
                    password = '$pass',
                    foto = '$foto'
                  WHERE sid = '$sid'";
    } else {
        $query = "INSERT INTO users (sid, nama, role, rfid_uid, password, foto) 
                  VALUES ('$sid', '$nama', '$role', $rfid_sql, '$pass', '$foto')";
    }
    
    if (mysqli_query($koneksi, $query)) {
        $foto_response = (strpos($foto_clean, 'data:image/') === 0)
            ? 'api/get_user_photo.php?uid=' . rawurlencode(trim((string)$sid_raw))
            : $foto_clean;
        http_response_code(200);
        echo json_encode([
            "success" => true,
            "message" => "Data karyawan [$nama] berhasil disimpan!",
            "foto" => $foto_response,
            "foto_url" => $foto_response
        ]);
    } else {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
    }
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ID Karyawan (SID) dan Nama wajib diisi!"]);
}
?>