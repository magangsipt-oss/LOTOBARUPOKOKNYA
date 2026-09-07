<?php
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Device-Token, Origin, Accept");

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

$raw_input = file_get_contents('php://input');
$data = json_decode($raw_input, true);

if ($_SERVER['REQUEST_METHOD'] === 'GET' && empty($data)) {
    http_response_code(200);
    echo json_encode(["success" => null, "message" => "Endpoint update_status.php aktif dan siap menerima data POST."]);
    exit();
}

if (!empty($data)) {
    $id_box_raw = $data['id_box'] ?? $data['id'] ?? 'BOX ELOTO 1';
    $event_raw  = $data['event'] ?? $data['status_event'] ?? $data['last_event'] ?? 'CARD_TAP';
    $uid_raw    = $data['uid'] ?? $data['rfid_uid'] ?? $data['rfidUid'] ?? $data['card_uid'] ?? $data['last_uid'] ?? '';
    $lat_raw    = $data['lat'] ?? 2.144691;
    $lng_raw    = $data['lng'] ?? $data['lon'] ?? 117.477526;
    $relay_open = isset($data['relay_open']) ? (int)$data['relay_open'] : (isset($data['solenoid_status']) ? (int)$data['solenoid_status'] : 0);
    $state = mysqli_real_escape_string($koneksi, trim((string)($data['state'] ?? 'STATE_IDLE')));
    $lcd0 = mysqli_real_escape_string($koneksi, trim((string)($data['lcd0'] ?? '')));
    $lcd1 = mysqli_real_escape_string($koneksi, trim((string)($data['lcd1'] ?? '')));
    $ssid = mysqli_real_escape_string($koneksi, trim((string)($data['ssid'] ?? '')));

    $id_box = mysqli_real_escape_string($koneksi, trim((string)$id_box_raw));
    $reported_box_id = $id_box;
    $event  = mysqli_real_escape_string($koneksi, trim((string)$event_raw));
    $uid    = mysqli_real_escape_string($koneksi, trim((string)$uid_raw));
    $device_ip = mysqli_real_escape_string($koneksi, trim((string)($data['ip'] ?? '')));
    
    $lat = (is_numeric($lat_raw) && (float)$lat_raw != 0) ? (float)$lat_raw : 2.144691;
    $lng = (is_numeric($lng_raw) && (float)$lng_raw != 0) ? (float)$lng_raw : 117.477526;
    $waktu_sekarang = date('Y-m-d H:i:s');
    $is_heartbeat = stripos($event, 'HEARTBEAT') !== false || stripos($event, 'SYS_') === 0;
    $payload_json = mysqli_real_escape_string($koneksi, $raw_input);

    $box_exists = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE id_box = '$id_box' LIMIT 1");
    // ID ESP32 berasal dari MAC dan tetap sama walaupun berpindah jaringan/IP.
    if ((!$box_exists || mysqli_num_rows($box_exists) === 0) && stripos($reported_box_id, 'ESP32-') === 0) {
        $device_id_pattern = mysqli_real_escape_string($koneksi, '%"id_box":"' . $reported_box_id . '"%');
        $known_device = mysqli_query($koneksi, "SELECT id_box FROM boxes
            WHERE id_box NOT LIKE 'ESP32-%' AND hw_data LIKE '$device_id_pattern' LIMIT 1");
        if ($known_device && mysqli_num_rows($known_device) > 0) {
            $id_box = mysqli_real_escape_string($koneksi, mysqli_fetch_assoc($known_device)['id_box']);
            $box_exists = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE id_box = '$id_box' LIMIT 1");
        }
    }
    if ((!$box_exists || mysqli_num_rows($box_exists) === 0) && $device_ip !== '' && $device_ip !== '192.168.1.100') {
        $linked_box = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE ip = '$device_ip' AND id_box NOT LIKE 'ESP32-%' LIMIT 1");
        if ($linked_box && mysqli_num_rows($linked_box) > 0) {
            $id_box = mysqli_real_escape_string($koneksi, mysqli_fetch_assoc($linked_box)['id_box']);
            $box_exists = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE id_box = '$id_box' LIMIT 1");
            if (stripos($reported_box_id, 'ESP32-') === 0) {
                @mysqli_query($koneksi, "DELETE FROM boxes WHERE id_box = '$reported_box_id'");
            }
        }
    }
    if (!$box_exists || mysqli_num_rows($box_exists) === 0) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Boks [$id_box] belum terdaftar. Tambahkan boks dari menu Kelola Boks terlebih dahulu."]);
        exit();
    }

    if (!$is_heartbeat && (empty($uid) || strtoupper($uid) === 'SYSTEM' || $uid === '—')) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "UID Kartu tidak boleh kosong!"]);
        exit();
    }

    // 1. Cek status kartu di tabel master pengguna
    $clean_uid = strtolower(preg_replace('/[^A-Za-z0-9]/', '', $uid));
    $clean_uid_esc = mysqli_real_escape_string($koneksi, $clean_uid);
    
    $user_query = !$is_heartbeat ? mysqli_query($koneksi, "SELECT * FROM users WHERE 
                  LOWER(TRIM(REPLACE(rfid_uid, ' ', ''))) = '$clean_uid_esc' OR 
                  LOWER(TRIM(REPLACE(sid, ' ', ''))) = '$clean_uid_esc' OR 
                  LOWER(TRIM(REPLACE(fp_id, ' ', ''))) = '$clean_uid_esc' 
                  LIMIT 1") : false;

    $user_name = "Karyawan Tidak Terdaftar";
    $role = "Unknown";
    $is_registered = false;

    if ($user_query && mysqli_num_rows($user_query) > 0) {
        $user_data = mysqli_fetch_assoc($user_query);
        $user_name = !empty($user_data['nama']) ? $user_data['nama'] : 'Karyawan';
        $role      = !empty($user_data['role']) ? $user_data['role'] : 'teknisi';
        $is_registered = true;
    } elseif (!$is_heartbeat) {
        // 2. Jika kartu belum terdaftar, masukkan ke buffer kartu untuk Admin web
        @mysqli_query($koneksi, "INSERT INTO rfid_buffer (id_box, rfid_uid, created_at) 
                                VALUES ('$id_box', '" . strtoupper($uid) . "', '$waktu_sekarang')
                                ON DUPLICATE KEY UPDATE id_box = '$id_box', created_at = '$waktu_sekarang'");
    }

    // 3. Update kondisi boks di tabel boxes
    $query_update = "UPDATE boxes SET 
                        last_uid = '$uid',
                        last_event = '$event',
                        state = '$state',
                        lcd0 = '$lcd0',
                        lcd1 = '$lcd1',
                        hw_data = '$payload_json',
                        ssid = " . ($ssid !== '' ? "'$ssid'" : "ssid") . ",
                        ip = " . ($device_ip !== '' ? "'$device_ip'" : "ip") . ",
                        relay_open = $relay_open,
                        lat = $lat,
                        lng = $lng,
                        is_online = 1,
                        last_ping = '$waktu_sekarang'
                     WHERE id_box = '$id_box'";
    mysqli_query($koneksi, $query_update);

    // 4. Catat riwayat ke audit log permanen
    mysqli_query($koneksi, "INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal) 
                            VALUES ('$id_box', '$event', '$uid', $lat, $lng, '$waktu_sekarang')");

    // 5. Hanya event tap yang dicatat sebagai riwayat sesi, bukan heartbeat atau event sistem.
    $is_tap_event = isset($data['is_tap'])
        ? filter_var($data['is_tap'], FILTER_VALIDATE_BOOLEAN)
        : preg_match('/(supervisor_lock_in|supervisor_log_out|mechanic_log_in|mechanic_log_out|refuel_start|refuel_end)/i', $event) === 1;
    $event_type = preg_match('/(out|keluar|exit|close|finish|done|end)/i', $event) ? 'OUT' : 'IN';
    $event_esc = mysqli_real_escape_string($koneksi, trim((string)$event));
    $uid_esc = mysqli_real_escape_string($koneksi, trim((string)$uid));
    $is_register_scan = isset($data['is_register_scan'])
        ? filter_var($data['is_register_scan'], FILTER_VALIDATE_BOOLEAN)
        : preg_match('/register_new_card/i', $event) === 1;

    if ($is_register_scan) {
        mysqli_query($koneksi, "INSERT INTO rfid_buffer (id_box, rfid_uid, created_at)
                                VALUES ('$id_box', '" . strtoupper($uid_esc) . "', '$waktu_sekarang')
                                ON DUPLICATE KEY UPDATE id_box = '$id_box', created_at = '$waktu_sekarang'");
    }

    if ($is_tap_event && $is_registered) {
        $nama_tapping = $user_name;
        $name_query = mysqli_real_escape_string($koneksi, trim((string)$user_name));
        $tapping_insert_ok = mysqli_query($koneksi, "INSERT INTO tapping_history (id_box, rfid_uid, nama, event_type, event_text, lat, lng)
                                VALUES ('$id_box', '$uid_esc', '$name_query', '$event_type', '$event_esc', $lat, $lng)");
        if (!$tapping_insert_ok) {
            http_response_code(500);
            echo json_encode(["success" => false, "message" => "Gagal menyimpan riwayat tapping: " . mysqli_error($koneksi)]);
            exit();
        }
    }

    http_response_code(200);
    echo json_encode([
        "success"        => true,
        "message"       => $is_registered ? "Kartu [$user_name] ($role) diproses!" : "Kartu belum terdaftar (disimpan ke antrean buffer)",
        "is_registered" => $is_registered,
        "id_box"        => $id_box,
        "user_name"     => $user_name,
        "role"          => $role,
        "relay_open"    => $relay_open,
        "event_type"    => $event_type,
        "is_tap"        => $is_tap_event,
        "is_register_scan" => $is_register_scan
    ]);
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Payload Data JSON tidak valid atau kosong!"]);
}
?>