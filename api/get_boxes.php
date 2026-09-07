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

$query = "SELECT * FROM boxes ORDER BY id_box ASC";
$result = mysqli_query($koneksi, $query);
$boxes = [];

if ($result) {
    $current_time = time();

    while ($row = mysqli_fetch_assoc($result)) {
        
        // 1. Decode & Merge Payload Telemetri Hardware jika ada
        if (!empty($row['hw_data'])) {
            $hw_decoded = json_decode($row['hw_data'], true);
            if (is_array($hw_decoded)) {
                $row = array_merge($hw_decoded, $row); 
            }
        }

        // 2. Sinkronisasi ID Kunci untuk Frontend React
        if (isset($row['id_box']) && !isset($row['id'])) {
            $row['id'] = $row['id_box'];
        } elseif (isset($row['id']) && !isset($row['id_box'])) {
            $row['id_box'] = $row['id'];
        }

        // 3. Normalisasi Koordinat GPS Presisi
        $lat = (isset($row['lat']) && !empty($row['lat']) && (float)$row['lat'] != 0) ? (float)$row['lat'] : 2.144691;
        $lng = (isset($row['lng']) && !empty($row['lng']) && (float)$row['lng'] != 0) ? (float)$row['lng'] : 117.477526;
        
        $row['lat'] = $lat;
        $row['lng'] = $lng;
        $row['lon'] = $lng;

        // 4. Default Field Khusus
        $row['active_fuelman'] = $row['active_fuelman'] ?? '';
        $row['supervisor_uid'] = $row['supervisor_uid'] ?? '—';
        $row['ssid']           = !empty($row['ssid']) ? $row['ssid'] : 'Wi-Fi Hotspot';
        $row['ip']             = !empty($row['ip']) ? $row['ip'] : '192.168.1.100';

        // 5. Perangkat hanya online jika heartbeat benar-benar masih baru.
        $is_online = 0; 
        $time_marker = !empty($row['last_ping']) ? $row['last_ping'] : ($row['updated_at'] ?? '');
        
        if (!empty($time_marker)) {
            $last_ping_time = strtotime($time_marker);
            $selisih_detik = $current_time - $last_ping_time;
            
            // Beri toleransi kecil untuk perbedaan jam, tanpa mempertahankan status stale.
            if (
                ($selisih_detik <= 20 && $selisih_detik >= -5) || 
                (abs($selisih_detik - 28800) <= 20) || 
                (abs($selisih_detik - 25200) <= 20) ||
                (abs($selisih_detik + 28800) <= 20) ||
                (abs($selisih_detik + 25200) <= 20)
            ) {
                $is_online = 1;
            }
        }
        $row['is_online'] = (int)$is_online;

        // 6. Normalisasi Antrean Queue
        if (isset($row['queue']) && is_string($row['queue'])) {
            $decoded_q = json_decode($row['queue'], true);
            if (is_array($decoded_q)) {
                $row['queue'] = $decoded_q;
            }
        }
        if (!isset($row['queue']) || !is_array($row['queue'])) {
            $row['queue'] = [];
        }

        // 7. Batasi Ukuran Audit Log JSON
        if (isset($row['audit_log']) && is_array($row['audit_log'])) {
            $row['audit_log'] = array_slice($row['audit_log'], -10);
        }
        
        $boxes[] = $row;
    }
    
    http_response_code(200);
    echo json_encode($boxes);
} else {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Gagal mengambil data: " . mysqli_error($koneksi)]);
}
?>