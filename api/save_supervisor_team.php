<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Device-Token, Origin, Accept');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
require_once 'koneksi.php';

mysqli_query($koneksi, "CREATE TABLE IF NOT EXISTS supervisor_box_team (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supervisor_sid VARCHAR(100) NOT NULL,
    id_box VARCHAR(100) NOT NULL,
    mechanic_sid VARCHAR(100) NOT NULL,
    maintenance_type VARCHAR(30) NOT NULL DEFAULT 'Mekanikal',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supervisor_box_mechanic_type (supervisor_sid, id_box, mechanic_sid, maintenance_type),
    INDEX idx_supervisor_box (supervisor_sid, id_box)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$columnCheck = mysqli_query($koneksi, "SHOW COLUMNS FROM supervisor_box_team LIKE 'maintenance_type'");
if ($columnCheck && mysqli_num_rows($columnCheck) === 0) {
    mysqli_query($koneksi, "ALTER TABLE supervisor_box_team ADD COLUMN maintenance_type VARCHAR(30) NOT NULL DEFAULT 'Mekanikal'");
}
$legacyIndex = mysqli_query($koneksi, "SHOW INDEX FROM supervisor_box_team WHERE Key_name = 'uq_supervisor_box_mechanic'");
$newIndex = mysqli_query($koneksi, "SHOW INDEX FROM supervisor_box_team WHERE Key_name = 'uq_supervisor_box_mechanic_type'");
if ($legacyIndex && mysqli_num_rows($legacyIndex) > 0) {
    mysqli_query($koneksi, "ALTER TABLE supervisor_box_team DROP INDEX uq_supervisor_box_mechanic");
}
if ($newIndex && mysqli_num_rows($newIndex) === 0) {
    mysqli_query($koneksi, "ALTER TABLE supervisor_box_team ADD UNIQUE KEY uq_supervisor_box_mechanic_type (supervisor_sid, id_box, mechanic_sid, maintenance_type)");
}

$data = json_decode(file_get_contents('php://input'), true) ?: [];
$supervisor = trim((string)($data['supervisor_sid'] ?? ''));
$idBox = trim((string)($data['id_box'] ?? ''));
$maintenanceType = trim((string)($data['maintenance_type'] ?? 'Mekanikal'));
$mechanics = is_array($data['mechanic_sids'] ?? null) ? $data['mechanic_sids'] : [];
if ($supervisor === '' || $idBox === '') { http_response_code(400); echo json_encode(['success' => false, 'message' => 'Pengawas dan box wajib dipilih.']); exit; }
if (!in_array($maintenanceType, ['Mekanikal', 'Elektrikal', 'Hidrolik'], true)) { http_response_code(400); echo json_encode(['success' => false, 'message' => 'Jenis maintenance tidak valid.']); exit; }

$supervisorEsc = mysqli_real_escape_string($koneksi, $supervisor);
$idBoxEsc = mysqli_real_escape_string($koneksi, $idBox);
$validSupervisor = mysqli_query($koneksi, "SELECT sid FROM users WHERE sid='$supervisorEsc' AND (LOWER(role) LIKE '%pengawas%' OR LOWER(role) LIKE '%spv%' OR LOWER(role) LIKE '%k3%') LIMIT 1");
if (!$validSupervisor || mysqli_num_rows($validSupervisor) === 0) { http_response_code(403); echo json_encode(['success' => false, 'message' => 'Akun bukan pengawas yang valid.']); exit; }

mysqli_begin_transaction($koneksi);
try {
    if (!mysqli_query($koneksi, "DELETE FROM supervisor_box_team WHERE supervisor_sid='$supervisorEsc' AND id_box='$idBoxEsc'")) throw new Exception(mysqli_error($koneksi));
    foreach ($mechanics as $mechanic) {
        $mechanicEsc = mysqli_real_escape_string($koneksi, trim((string)$mechanic));
        if ($mechanicEsc === '') continue;
        $validMechanic = mysqli_query($koneksi, "SELECT sid FROM users WHERE sid='$mechanicEsc' AND (LOWER(role) LIKE '%teknisi%' OR LOWER(role) LIKE '%mekanik%') LIMIT 1");
        if ($validMechanic && mysqli_num_rows($validMechanic) > 0) {
            $maintenanceTypeEsc = mysqli_real_escape_string($koneksi, $maintenanceType);
            if (!mysqli_query($koneksi, "INSERT INTO supervisor_box_team (supervisor_sid, id_box, mechanic_sid, maintenance_type) VALUES ('$supervisorEsc', '$idBoxEsc', '$mechanicEsc', '$maintenanceTypeEsc')")) throw new Exception(mysqli_error($koneksi));
        }
    }
    mysqli_commit($koneksi);
    echo json_encode(['status' => 'success', 'message' => 'Tim mekanik untuk box berhasil disimpan.']);
} catch (Exception $error) {
    mysqli_rollback($koneksi);
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $error->getMessage()]);
}
?>
