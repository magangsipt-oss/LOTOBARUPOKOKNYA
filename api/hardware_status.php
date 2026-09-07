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

$id_box_raw = $_GET['id_box'] ?? $_GET['id'] ?? '';
$id_box = mysqli_real_escape_string($koneksi, trim((string)$id_box_raw));

$query = "SELECT 
            b.id_box, 
            b.unit,
            b.state,
            b.relay_open,
            b.supervisor_uid,
            b.last_event,
            b.last_uid, 
            b.lat, 
            b.lng, 
            b.is_online,
            b.last_ping,
            b.updated_at,
            u.nama AS last_user_name,
            u.role AS last_user_role
          FROM boxes b
          LEFT JOIN users u ON (b.last_uid = u.rfid_uid OR b.last_uid = u.sid)";

if (!empty($id_box)) {
    $query .= " WHERE b.id_box = '$id_box' LIMIT 1";
} else {
    $query .= " ORDER BY b.id_box ASC";
}

$result = mysqli_query($koneksi, $query);

if ($result) {
    $hardware_list = [];
    $current_time = time();
    
    while ($row = mysqli_fetch_assoc($result)) {
        // Samakan batas dengan get_boxes.php agar status dashboard konsisten.
        $time_marker = !empty($row['last_ping']) ? $row['last_ping'] : $row['updated_at'];
        $last_update = !empty($time_marker) ? strtotime($time_marker) : 0;
        $selisih_detik = $current_time - $last_update;

        $is_online = (
            ($selisih_detik <= 20 && $selisih_detik >= -5) || 
            (abs($selisih_detik - 28800) <= 20) || 
            (abs($selisih_detik - 25200) <= 20)
        ) ? 1 : 0;

        $hardware_list[] = [
            "id_box"          => $row['id_box'],
            "unit"            => $row['unit'],
            "state"           => $row['state'],
            "is_online"       => (bool)$is_online,
            "status_text"     => $is_online ? "RADAR ONLINE" : "RADAR OFFLINE",
            "last_uid"        => $row['last_uid'],
            "last_user_name"  => !empty($row['last_user_name']) ? $row['last_user_name'] : 'Unknown',
            "last_user_role"  => !empty($row['last_user_role']) ? $row['last_user_role'] : 'Unknown',
            "status_event"    => $row['last_event'],
            "solenoid_status" => (int)$row['relay_open'] === 1 ? "UNLOCKED" : "LOCKED",
            "relay_open"      => (int)$row['relay_open'],
            "gps" => [
                "lat" => (float)$row['lat'],
                "lng" => (float)$row['lng'],
                "lon" => (float)$row['lng']
            ],
            "last_seen"       => $time_marker
        ];
    }

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "data"   => !empty($id_box) ? ($hardware_list[0] ?? null) : $hardware_list
    ]);
} else {
    http_response_code(500);
    echo json_encode([
        "success"  => false,
        "message" => "MySQL Error: " . mysqli_error($koneksi)
    ]);
}
?>