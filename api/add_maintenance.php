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

require_once "koneksi.php";
if (!isset($koneksi) && isset($mysqli)) { $koneksi = $mysqli; }
if (!isset($koneksi) && isset($conn)) { $koneksi = $conn; }

if (!$koneksi) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database"]);
    exit();
}

$rawInput = file_get_contents("php://input");
$data = json_decode($rawInput, true);

if (isset($data['mesin']) || isset($data['id_box'])) {
    $id_box_raw = $data['id_box'] ?? $data['mesin'];
    $mesin_raw  = $data['mesin'] ?? $id_box_raw;
    
    $id_box    = mysqli_real_escape_string($koneksi, trim((string)$id_box_raw));
    $mesin     = mysqli_real_escape_string($koneksi, trim((string)$mesin_raw));
    $jenis     = mysqli_real_escape_string($koneksi, trim((string)($data['jenis'] ?? 'Mekanikal')));
    $estimasi  = mysqli_real_escape_string($koneksi, trim((string)($data['estimasi'] ?? '4 Jam')));
    $teknisi   = mysqli_real_escape_string($koneksi, trim((string)($data['teknisi'] ?? '')));
    $pengawas  = mysqli_real_escape_string($koneksi, trim((string)($data['pengawas'] ?? '-')));
    $deskripsi = mysqli_real_escape_string($koneksi, trim((string)($data['deskripsi'] ?? '')));
    $status    = mysqli_real_escape_string($koneksi, trim((string)($data['status'] ?? 'PROSES')));
    
    $waktu = date('Y-m-d H:i:s');

    // Proses konversi gambar base64 ke direktori uploads/
    $foto_url = '';
    if (!empty($data['foto']) && strpos($data['foto'], 'data:image') !== false) {
        if (!file_exists('uploads')) {
            mkdir('uploads', 0755, true);
        }
        
        @list($type, $file_data) = explode(';', $data['foto']);
        @list(, $file_data)      = explode(',', $file_data);
        
        $ext = 'jpg';
        if (strpos($type, 'png') !== false) { $ext = 'png'; }
        
        $file_name = "loto_" . uniqid() . "_" . time() . '.' . $ext;
        $file_path = "uploads/" . $file_name;
        
        if (file_put_contents($file_path, base64_decode($file_data))) {
            $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' || $_SERVER['SERVER_PORT'] == 443) ? "https://" : "http://";
            $dirPath  = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
            $foto_url = $protocol . $_SERVER['HTTP_HOST'] . $dirPath . "/" . $file_path;
        }
    } else {
        $foto_url = isset($data['foto']) ? mysqli_real_escape_string($koneksi, $data['foto']) : '';
    }

    $query = "INSERT INTO maintenance_logs (waktu, id_box, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto) 
              VALUES ('$waktu', '$id_box', '$mesin', '$jenis', '$estimasi', '$teknisi', '$pengawas', '$deskripsi', '$status', '$foto_url')";
              
    if (mysqli_query($koneksi, $query)) {
        http_response_code(200);
        echo json_encode(["success" => true, "message" => "Laporan kerusakan berhasil disimpan!"]);
    } else {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "MySQL Error: " . mysqli_error($koneksi)]);
    }
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Parameter wajib: id_box atau mesin"]);
}
?>