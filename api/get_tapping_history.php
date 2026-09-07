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
    echo json_encode(["success" => false, "message" => "Gagal terhubung ke database MySQL"]);
    exit();
}

// Hapus data lama yang pernah tercatat dari kartu yang belum terdaftar.
mysqli_query($koneksi, "DELETE t FROM tapping_history t
    LEFT JOIN users u ON (
        LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) OR
        LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.sid), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) OR
        LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.fp_id), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', ''))
    )
    WHERE u.sid IS NULL");

$id_box = isset($_GET['id_box']) ? mysqli_real_escape_string($koneksi, trim((string)$_GET['id_box'])) : '';
$uid = isset($_GET['uid']) ? mysqli_real_escape_string($koneksi, trim((string)$_GET['uid'])) : '';
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 200;
$box_filter = '';

if (!empty($id_box)) {
    $box_ids = [$id_box];
    $selected_box_query = mysqli_query($koneksi, "SELECT ip FROM boxes WHERE id_box = '$id_box' LIMIT 1");
    if ($selected_box_query && mysqli_num_rows($selected_box_query) > 0) {
        $selected_box = mysqli_fetch_assoc($selected_box_query);
        $selected_ip = mysqli_real_escape_string($koneksi, trim((string)($selected_box['ip'] ?? '')));
        if ($selected_ip !== '') {
            $linked_boxes_query = mysqli_query($koneksi, "SELECT id_box FROM boxes WHERE ip = '$selected_ip'");
            if ($linked_boxes_query) {
                while ($linked_box = mysqli_fetch_assoc($linked_boxes_query)) {
                    $box_ids[] = $linked_box['id_box'];
                }
            }
        }
    }
    $box_ids = array_values(array_unique(array_map(function ($box_id) use ($koneksi) {
        return "'" . mysqli_real_escape_string($koneksi, trim((string)$box_id)) . "'";
    }, $box_ids)));
    $box_filter = " AND t.id_box IN (" . implode(',', $box_ids) . ")";
}

$query = "SELECT t.id, t.id_box, t.event_text AS event, t.rfid_uid, t.lat, t.lng, t.created_at AS tanggal,
                 t.event_type, t.nama AS nama_tapping, u.nama AS nama_karyawan, u.role AS role_karyawan
          FROM tapping_history t
          LEFT JOIN users u ON (
              LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) OR
              LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.sid), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', '')) OR
              LOWER(REPLACE(REPLACE(REPLACE(TRIM(u.fp_id), ' ', ''), '\\r', ''), '\\n', '')) = LOWER(REPLACE(REPLACE(REPLACE(TRIM(t.rfid_uid), ' ', ''), '\\r', ''), '\\n', ''))
          )
                    WHERE u.sid IS NOT NULL
                        AND UPPER(t.event_text) IN ('SUPERVISOR_LOCK_IN', 'SUPERVISOR_LOG_OUT', 'MECHANIC_LOG_IN', 'MECHANIC_LOG_OUT', 'REFUEL_START', 'REFUEL_END')";

if ($box_filter !== '') {
    $query .= $box_filter;
}

if (!empty($uid)) {
    $query .= " AND (t.rfid_uid = '$uid' OR u.sid = '$uid')";
}

$query .= " ORDER BY t.created_at DESC LIMIT $limit";

$result = mysqli_query($koneksi, $query);
$rows = [];

if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $rows[] = [
            'id' => (int)$row['id'],
            'id_box' => $row['id_box'],
            'uid' => $row['rfid_uid'] ?? '',
            'nama' => !empty($row['nama_tapping']) ? $row['nama_tapping'] : (!empty($row['nama_karyawan']) ? $row['nama_karyawan'] : 'Personel Belum Terdaftar'),
            'event' => $row['event'],
            'event_type' => $row['event'],
            'lat' => (float)($row['lat'] ?? 0),
            'lng' => (float)($row['lng'] ?? 0),
            'created_at' => $row['tanggal'] ?? null
        ];
    }
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal membaca tapping_history: " . mysqli_error($koneksi)]);
    exit();
}

$rows = array_reverse($rows);

$sessions = [];
$openByBox = [];
$sessionNumberByBox = [];

foreach ($rows as $event) {
    $box = trim((string)$event['id_box']);
    $label = strtolower((string)($event['event'] ?? ''));
    $isSupervisorStart = preg_match('/(supervisor_lock_in|supervisor.*(in|masuk)|spv.*(in|masuk)|supervisor_start)/i', $label) === 1;
    $isSessionEnd = preg_match('/(supervisor_log_out|supervisor.*(out|keluar)|spv.*(out|keluar)|maintenance_done|session.*(close|end)|finish|done)/i', $label) === 1;

    if ($isSupervisorStart || !isset($openByBox[$box])) {
        if ($isSupervisorStart || !isset($openByBox[$box])) {
            $sessionNumberByBox[$box] = ($sessionNumberByBox[$box] ?? 0) + 1;
            $sessionId = $box . '-' . ($event['created_at'] ?? '') . '-' . $sessionNumberByBox[$box];
            $openByBox[$box] = $sessionId;
            $sessions[$sessionId] = [
                'session_id' => $sessionId,
                'id' => $event['id'],
                'id_box' => $box,
                'session_start' => $event['created_at'],
                'session_end' => null,
                'event_text' => $event['event'],
                'participants' => [],
                'event_ids' => []
            ];
        }
    }

    $sessionId = $openByBox[$box];
    $sessions[$sessionId]['event_ids'][] = (int)$event['id'];
    $uidKey = strtolower(trim((string)$event['uid']));
    if ($uidKey !== '') {
        $participantStatus = preg_match('/(out|keluar|end)/i', $label) === 1 ? 'KELUAR' : 'MASUK';
        $sessions[$sessionId]['participants'][$uidKey] = [
            'uid' => $event['uid'],
            'nama' => $event['nama'],
            'status' => $participantStatus,
            'last_event' => $event['event']
        ];
    }

    if ($isSessionEnd) {
        $sessions[$sessionId]['session_end'] = $event['created_at'];
        unset($openByBox[$box]);
    }
}

$history = [];
foreach ($sessions as $session) {
    $session['participants'] = array_values($session['participants']);
    $session['total_personel'] = count($session['participants']);
    $session['ended_at'] = $session['session_end'];
    $session['status_label'] = $session['session_end'] ? 'SESI SELESAI' : 'SESI AKTIF';
    $history[] = $session;
}

usort($history, function ($a, $b) {
    return strcmp((string)($b['session_start'] ?? ''), (string)($a['session_start'] ?? ''));
});

http_response_code(200);
echo json_encode($history);
?>
