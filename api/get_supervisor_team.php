<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Device-Token, Origin, Accept');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once 'koneksi.php';

$supervisor = trim((string)($_GET['supervisor_sid'] ?? ''));
$idBox = trim((string)($_GET['id_box'] ?? ''));
if ($supervisor === '' || $idBox === '') { echo json_encode([]); exit; }

$supervisorEsc = mysqli_real_escape_string($koneksi, $supervisor);
$idBoxEsc = mysqli_real_escape_string($koneksi, $idBox);
$query = "SELECT t.mechanic_sid, t.maintenance_type, u.nama, u.rfid_uid, u.foto, u.role
          FROM supervisor_box_team t
          INNER JOIN users u ON u.sid = t.mechanic_sid
          WHERE t.supervisor_sid = '$supervisorEsc' AND t.id_box = '$idBoxEsc'
          ORDER BY u.nama ASC";
$result = mysqli_query($koneksi, $query);
$team = [];
if ($result) {
    while ($row = mysqli_fetch_assoc($result)) {
        $team[] = [
            'sid' => $row['mechanic_sid'],
            'maintenance_type' => $row['maintenance_type'] ?? 'Mekanikal',
            'nama' => $row['nama'],
            'rfid_uid' => $row['rfid_uid'] ?? '',
            'foto' => $row['foto'] ?? '',
            'role' => $row['role'] ?? 'teknisi'
        ];
    }
}
echo json_encode($team);
?>
