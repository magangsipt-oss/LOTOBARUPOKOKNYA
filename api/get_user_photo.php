<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: *");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit();
}

require_once __DIR__ . '/koneksi.php';

$uid_raw = $_GET['uid'] ?? '';
$uid = strtolower(preg_replace('/[^A-Za-z0-9]/', '', trim((string)$uid_raw)));

if ($uid === '') {
    http_response_code(400);
    exit('UID kosong');
}

$uid_sql = mysqli_real_escape_string($koneksi, $uid);
$requestedSize = filter_input(INPUT_GET, 'size', FILTER_VALIDATE_INT);
$requestedQuality = filter_input(INPUT_GET, 'quality', FILTER_VALIDATE_INT);
$size = ($requestedSize && $requestedSize >= 80 && $requestedSize <= 240) ? $requestedSize : 0;
$quality = ($requestedQuality && $requestedQuality >= 60 && $requestedQuality <= 95) ? $requestedQuality : 85;

$query = "SELECT foto FROM users WHERE
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(rfid_uid), ' ', ''), '\\r', ''), '\\n', ''), ':', ''), '-', '')) = '$uid_sql' OR
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(sid), ' ', ''), '\\r', ''), '\\n', ''), ':', ''), '-', '')) = '$uid_sql' OR
          LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(fp_id), ' ', ''), '\\r', ''), '\\n', ''), ':', ''), '-', '')) = '$uid_sql'
          LIMIT 1";
$result = mysqli_query($koneksi, $query);
$row = $result ? mysqli_fetch_assoc($result) : null;
$photo = trim((string)($row['foto'] ?? ''));

// Foto profil baru disimpan sebagai Data URI di kolom users.foto.
if (preg_match('/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+\/=\r\n]+)$/', $photo, $matches)) {
    $imageData = base64_decode(str_replace(["\r", "\n"], '', $matches[2]), true);
    if ($imageData === false) {
        http_response_code(415);
        exit('Data foto tidak valid');
    }
    if ($size > 0 && function_exists('imagecreatefromstring') && function_exists('imagecreatetruecolor')) {
        $source = @imagecreatefromstring($imageData);
        if ($source !== false) {
            $sourceWidth = imagesx($source);
            $sourceHeight = imagesy($source);
            $cropSize = min($sourceWidth, $sourceHeight);
            $sourceX = (int)(($sourceWidth - $cropSize) / 2);
            $sourceY = (int)(($sourceHeight - $cropSize) / 2);
            $output = imagecreatetruecolor($size, $size);
            $white = imagecolorallocate($output, 255, 255, 255);
            imagefill($output, 0, 0, $white);
            imagecopyresampled($output, $source, 0, 0, $sourceX, $sourceY,
                $size, $size, $cropSize, $cropSize);

            ob_start();
            imagejpeg($output, null, $quality);
            $jpeg = ob_get_clean();
            imagedestroy($output);
            imagedestroy($source);

            if ($jpeg !== false && strlen($jpeg) > 100) {
                header('Content-Type: image/jpeg');
                header('Content-Length: ' . strlen($jpeg));
                echo $jpeg;
                exit();
            }
        }
    }

    $mime = 'image/' . ($matches[1] === 'jpg' ? 'jpeg' : $matches[1]);
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . strlen($imageData));
    echo $imageData;
    exit();
}

$fileName = basename(parse_url($photo, PHP_URL_PATH) ?: '');
$filePath = __DIR__ . '/uploads/user_profiles/' . $fileName;

if ($fileName === '' || !is_file($filePath)) {
    http_response_code(404);
    exit('Foto tidak ditemukan');
}

$mime = mime_content_type($filePath) ?: 'image/jpeg';
if (strpos($mime, 'image/') !== 0) {
    http_response_code(415);
    exit('Berkas bukan gambar');
}

// Kirim JPEG yang sudah sesuai ukuran area LCD agar ESP32 tidak melakukan
// downscale besar di perangkat dan kehilangan detail.
if ($size > 0 && function_exists('imagecreatefromstring') && function_exists('imagecreatetruecolor')) {
    $source = @imagecreatefromstring(file_get_contents($filePath));
    if ($source !== false) {
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $cropSize = min($sourceWidth, $sourceHeight);
        $sourceX = (int)(($sourceWidth - $cropSize) / 2);
        $sourceY = (int)(($sourceHeight - $cropSize) / 2);
        $output = imagecreatetruecolor($size, $size);
        $white = imagecolorallocate($output, 255, 255, 255);
        imagefill($output, 0, 0, $white);
        imagecopyresampled($output, $source, 0, 0, $sourceX, $sourceY, $size, $size, $cropSize, $cropSize);

        ob_start();
        imagejpeg($output, null, $quality);
        $jpeg = ob_get_clean();
        imagedestroy($output);
        imagedestroy($source);

        if ($jpeg !== false && strlen($jpeg) > 100) {
            header('Content-Type: image/jpeg');
            header('Content-Length: ' . strlen($jpeg));
            echo $jpeg;
            exit();
        }
    }
}

header('Content-Type: ' . $mime);
header('Content-Length: ' . filesize($filePath));
readfile($filePath);
?>
