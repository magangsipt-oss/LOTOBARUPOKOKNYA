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

require_once "koneksi.php";
if (!isset($koneksi) && isset($mysqli)) { $koneksi = $mysqli; }
if (!isset($koneksi) && isset($conn)) { $koneksi = $conn; }

if (!$koneksi) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

$raw_payload = file_get_contents("php://input");
$data = json_decode($raw_payload, true);

if (!empty($data) && (isset($data['id_box']) || isset($data['id']))) {
    $id_box_raw = $data['id_box'] ?? $data['id'];
    $id_box = mysqli_real_escape_string($koneksi, trim((string)$id_box_raw));
    $reported_box_id = $id_box;
    
    $state  = mysqli_real_escape_string($koneksi, (string)($data['state'] ?? 'STATE_IDLE'));
    $lcd0   = mysqli_real_escape_string($koneksi, (string)($data['lcd0'] ?? '  SISTEM READY'));
    $lcd1   = mysqli_real_escape_string($koneksi, (string)($data['lcd1'] ?? 'TEKAN 1 UTK MULAI'));
    $relay  = !empty($data['relay_open']) ? 1 : 0;
    
    $lat_raw = $data['lat'] ?? 2.144691;
    $lng_raw = $data['lng'] ?? $data['lon'] ?? 117.477526;
    $lat = (is_numeric($lat_raw) && (float)$lat_raw != 0) ? (float)$lat_raw : 2.144691;
    $lng = (is_numeric($lng_raw) && (float)$lng_raw != 0) ? (float)$lng_raw : 117.477526;
    
    $spv     = mysqli_real_escape_string($koneksi, (string)($data['supervisor_uid'] ?? '—'));
    $levent  = mysqli_real_escape_string($koneksi, (string)($data['last_event'] ?? 'HEARTBEAT_SYNC'));
    $luid    = mysqli_real_escape_string($koneksi, (string)($data['last_uid'] ?? 'SYSTEM'));
    $uptime  = (int)($data['uptime_ms'] ?? 0);
    $fuelman = mysqli_real_escape_string($koneksi, (string)($data['active_fuelman'] ?? ''));
    $ssid    = isset($data['ssid']) ? mysqli_real_escape_string($koneksi, (string)$data['ssid']) : '';
    $ip      = isset($data['ip']) ? mysqli_real_escape_string($koneksi, (string)$data['ip']) : '';
    
    $waktu_sekarang = date('Y-m-d H:i:s');
    $hw_data_escaped = mysqli_real_escape_string($koneksi, $raw_payload);

    $box_exists = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE id_box = '$id_box' LIMIT 1");
    if ((!$box_exists || mysqli_num_rows($box_exists) === 0) && $ip !== '' && $ip !== '192.168.1.100') {
        $linked_box = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE ip = '$ip' AND id_box NOT LIKE 'ESP32-%' LIMIT 1");
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

    // 1. Update Telemetri & Detak Jantung Perangkat
    $update_fields = [
        "lat = $lat",
        "lng = $lng",
        "state = '$state'",
        "lcd0 = '$lcd0'",
        "lcd1 = '$lcd1'",
        "relay_open = $relay",
        "supervisor_uid = '$spv'",
        "active_fuelman = '$fuelman'",
        "last_event = '$levent'",
        "last_uid = '$luid'",
        "uptime_ms = $uptime",
        "hw_data = '$hw_data_escaped'",
        "is_online = 1",
        "last_ping = '$waktu_sekarang'"
    ];

    if (!empty($ssid)) {
        $update_fields[] = "ssid = '$ssid'";
    }
    if (!empty($ip)) {
        $update_fields[] = "ip = '$ip'";
    }

    $query_update = "UPDATE boxes SET " . implode(', ', $update_fields) . " WHERE id_box = '$id_box'";
    mysqli_query($koneksi, $query_update);

    // 2. Sinkronkan antrean gembok aktif
    if (isset($data['queue']) && is_array($data['queue'])) {
        mysqli_query($koneksi, "DELETE FROM queue WHERE id_box = '$id_box'");
        foreach ($data['queue'] as $mekanik) {
            $uid_mekanik = is_array($mekanik) ? ($mekanik['uid'] ?? '') : $mekanik;
            if (!empty($uid_mekanik)) {
                $uid_esc = mysqli_real_escape_string($koneksi, trim((string)$uid_mekanik));
                mysqli_query($koneksi, "INSERT INTO queue (id_box, rfid_uid) VALUES ('$id_box', '$uid_esc')");
            }
        }
    }

    // 3. Catat ke audit log jika ada event operasional
    if (!empty($levent) && $levent !== '—' && $levent !== 'HEARTBEAT_SYNC') {
        $recent_event_query = mysqli_query($koneksi, "SELECT id FROM audit_logs
                                WHERE id_box = '$id_box' AND event = '$levent' AND rfid_uid = '$luid'
                                AND tanggal >= DATE_SUB('$waktu_sekarang', INTERVAL 10 SECOND)
                                ORDER BY id DESC LIMIT 1");
        if (!$recent_event_query || mysqli_num_rows($recent_event_query) === 0) {
            mysqli_query($koneksi, "INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal) 
                                    VALUES ('$id_box', '$levent', '$luid', $lat, $lng, '$waktu_sekarang')");
        }

        // Perangkat mengirim tap melalui endpoint telemetry, jadi simpan juga ke riwayat sesi.
        $is_tap_event = preg_match('/^(SUPERVISOR_LOCK_IN|SUPERVISOR_LOG_OUT|MECHANIC_LOG_IN|MECHANIC_LOG_OUT|REFUEL_START|REFUEL_END)$/i', trim($levent)) === 1;
        $valid_tap_uid = $luid !== '' && strtoupper($luid) !== 'SYSTEM' && $luid !== '—';
        if ($is_tap_event && $valid_tap_uid) {
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

            $recent_tap_query = mysqli_query($koneksi, "SELECT id FROM tapping_history
                                    WHERE id_box = '$id_box' AND rfid_uid = '$luid' AND event_text = '$levent'
                                    AND created_at >= DATE_SUB('$waktu_sekarang', INTERVAL 10 SECOND)
                                    ORDER BY id DESC LIMIT 1");
            if (!$recent_tap_query || mysqli_num_rows($recent_tap_query) === 0) {
                $tap_type = preg_match('/(out|keluar|exit|close|finish|done|end)/i', $levent) ? 'OUT' : 'IN';
                $tap_user_query = mysqli_query($koneksi, "SELECT nama FROM users
                                        WHERE rfid_uid = '$luid' OR sid = '$luid' OR fp_id = '$luid' LIMIT 1");
                if ($tap_user_query && mysqli_num_rows($tap_user_query) > 0) {
                    $tap_user = mysqli_real_escape_string($koneksi, (string)mysqli_fetch_assoc($tap_user_query)['nama']);
                    mysqli_query($koneksi, "INSERT INTO tapping_history
                        (id_box, rfid_uid, nama, event_type, event_text, lat, lng)
                        VALUES ('$id_box', '$luid', '$tap_user', '$tap_type', '$levent', $lat, $lng)");
                }
            }
        }
    }

    // 4. Periksa antrean perintah pending untuk mikrokontroler
    $cmd_res = mysqli_query($koneksi, "SELECT pending_cmd, cmd_param FROM boxes WHERE id_box = '$id_box' LIMIT 1");
    $cmd_to_send = "";
    $param_to_send = "";
    
    if ($cmd_res && mysqli_num_rows($cmd_res) > 0) {
        $cmd_row = mysqli_fetch_assoc($cmd_res);
        if (!empty($cmd_row['pending_cmd'])) {
            $cmd_to_send   = $cmd_row['pending_cmd'];
            $param_to_send = $cmd_row['cmd_param'];
            mysqli_query($koneksi, "UPDATE boxes SET pending_cmd = '', cmd_param = '' WHERE id_box = '$id_box'");
        }
    }
    
    http_response_code(200);
    echo json_encode([
        "success"      => true, 
        "message"     => "Telemetri dan heartbeat berhasil diperbarui!",
        "pending_cmd" => $cmd_to_send,
        "cmd_param"   => $param_to_send
    ]);
} else {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Payload telemetri tidak lengkap atau kosong!"]);
}
?>