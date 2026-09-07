<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

date_default_timezone_set('Asia/Makassar');
error_reporting(0);
require_once 'koneksi.php';

$id_box_raw = $_GET['id_box'] ?? $_GET['id'] ?? '';
$id_box = mysqli_real_escape_string($koneksi, trim((string)$id_box_raw));
if ($id_box === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'id_box wajib diisi']);
    exit();
}

$box_query = mysqli_query($koneksi, "SELECT * FROM boxes WHERE id_box = '$id_box' LIMIT 1");
$box = $box_query ? mysqli_fetch_assoc($box_query) : null;
if (!$box || empty($box['ip']) || $box['ip'] === '192.168.1.100') {
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'IP perangkat tidak tersedia']);
    exit();
}

$target = preg_match('/^https?:\/\//i', $box['ip']) ? $box['ip'] : 'http://' . $box['ip'];
$ch = curl_init(rtrim($target, '/') . '/status');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 1,
    CURLOPT_TIMEOUT => 2,
]);
$response = curl_exec($ch);
$curl_error = curl_error($ch);
curl_close($ch);

$device = json_decode((string)$response, true);
if (!is_array($device)) {
    mysqli_query($koneksi, "UPDATE boxes SET is_online = 0 WHERE id_box = '$id_box'");
    http_response_code(502);
    echo json_encode(['success' => false, 'message' => 'Perangkat tidak merespons', 'detail' => $curl_error]);
    exit();
}

$uid = trim((string)($device['last_uid'] ?? ''));
$state = mysqli_real_escape_string($koneksi, (string)($device['state'] ?? 'STATE_IDLE'));
$event = 'DIRECT_STATUS_TAP';
$now = date('Y-m-d H:i:s');
$lat = is_numeric($device['lat'] ?? null) ? (float)$device['lat'] : 2.144691;
$lng = is_numeric($device['lng'] ?? ($device['lon'] ?? null)) ? (float)($device['lng'] ?? $device['lon']) : 117.477526;
$relay = !empty($device['relay_open']) ? 1 : 0;
$uid_esc = mysqli_real_escape_string($koneksi, $uid);

mysqli_query($koneksi, "UPDATE boxes SET state = '$state', relay_open = $relay,
    last_uid = '$uid_esc', lat = $lat, lng = $lng, is_online = 1,
    last_ping = '$now', hw_data = '" . mysqli_real_escape_string($koneksi, (string)$response) . "'
    WHERE id_box = '$id_box'");

$recorded = false;
$old_uid = trim((string)($box['last_uid'] ?? ''));

// Dalam mode registrasi, UID tetap ditampilkan di dashboard meskipun sudah ada di users.
if ($state === 'STATE_REGISTER_RFID' && $uid !== '' && strtoupper($uid) !== 'SYSTEM' && $uid !== '—') {
    mysqli_query($koneksi, "INSERT INTO rfid_buffer (id_box, rfid_uid, created_at)
                            VALUES ('$id_box', '$uid_esc', '$now')
                            ON DUPLICATE KEY UPDATE id_box = '$id_box', created_at = '$now'");
}

if ($uid !== '' && strtoupper($uid) !== 'SYSTEM' && $uid !== '—' && strcasecmp($uid, $old_uid) !== 0) {
    mysqli_query($koneksi, "CREATE TABLE IF NOT EXISTS tapping_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_box VARCHAR(100) NOT NULL,
        rfid_uid VARCHAR(255) NOT NULL,
        nama VARCHAR(255) NULL,
        event_type ENUM('IN','OUT','CHECK') NOT NULL DEFAULT 'IN',
        event_text VARCHAR(255) NULL,
        lat DOUBLE NULL DEFAULT 2.144691,
        lng DOUBLE NULL DEFAULT 117.477526,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_box_uid (id_box, rfid_uid),
        INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $user_query = mysqli_query($koneksi, "SELECT nama FROM users WHERE rfid_uid = '$uid_esc' OR sid = '$uid_esc' OR fp_id = '$uid_esc' LIMIT 1");
    if ($user_query && mysqli_num_rows($user_query) > 0) {
        $nama_esc = mysqli_real_escape_string($koneksi, (string)mysqli_fetch_assoc($user_query)['nama']);
        $insert = mysqli_query($koneksi, "INSERT INTO tapping_history
            (id_box, rfid_uid, nama, event_type, event_text, lat, lng)
            VALUES ('$id_box', '$uid_esc', '$nama_esc', 'IN', '$event', $lat, $lng)");
        $recorded = $insert === true;
    }
}

echo json_encode(['success' => true, 'recorded' => $recorded, 'id_box' => $id_box, 'uid' => $uid, 'state' => $state]);
?>