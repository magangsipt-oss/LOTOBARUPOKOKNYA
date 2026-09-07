<?php
date_default_timezone_set('Asia/Makassar');

// Deteksi otomatis apakah script berjalan di Localhost (XAMPP) atau Server Hosting (cPanel)
$server_name = $_SERVER['SERVER_NAME'] ?? '';
$remote_addr = $_SERVER['REMOTE_ADDR'] ?? '';
$is_private_lan = filter_var($server_name, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)
    && (preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/', $server_name)
        || preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/', $remote_addr));
$is_local = ($server_name === 'localhost' || $server_name === '127.0.0.1'
    || in_array($remote_addr, ['127.0.0.1', '::1']) || $is_private_lan);

if ($is_local) {
    // KREDENSIAL LOCALHOST (XAMPP)
    $db_host = "localhost";
    $db_user = "root";
    $db_pass = "";
    $db_name = "wwweloto_siptv1"; // Sesuaikan jika nama database lokal Anda berbeda
} else {
    // KREDENSIAL CLOUD HOSTING (cPanel)
    $db_host = "localhost";
    $db_user = "wwweloto_siptv1";
    $db_pass = "Beraucoal123@#";
    $db_name = "wwweloto_siptv1";
}

// Inisialisasi koneksi MySQLi
$koneksi = @mysqli_connect($db_host, $db_user, $db_pass, $db_name);

// Fallback alias variabel agar kompatibel ke semua file API
$conn = $koneksi;
$mysqli = $koneksi;

// Periksa kegagalan koneksi
if (!$koneksi) {
    if (!headers_sent()) {
        header("Content-Type: application/json; charset=UTF-8");
    }
    http_response_code(500);
    echo json_encode([
        "success"  => false,
        "message" => "Koneksi Database Gagal: " . mysqli_connect_error()
    ]);
    exit();
}

// Standarisasi Charset ke UTF-8
mysqli_set_charset($koneksi, "utf8mb4");
?>