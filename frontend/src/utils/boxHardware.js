export function boxHardwareSnapshot(box) {
  const boksTerbaru = box || {};
  const bId = boksTerbaru.id;
  const isSmoothOnline = Number(boksTerbaru.is_online) === 1;
  let queueFinal = [];
  if (Array.isArray(boksTerbaru.queue)) { queueFinal = boksTerbaru.queue; }
  else if (typeof boksTerbaru.queue === 'string') { try { queueFinal = JSON.parse(boksTerbaru.queue); } catch {} }

  if (!Array.isArray(queueFinal)) queueFinal = [];

  return {
    id_box: bId,
    lcd0: boksTerbaru.lcd0 || '  SISTEM READY',
    lcd1: boksTerbaru.lcd1 || 'TEKAN 1 UTK MULAI',
    state: boksTerbaru.state || 'STATE_IDLE',
    relay_open: boksTerbaru.relay_open == 1 || boksTerbaru.relay_open === true,
    last_event: boksTerbaru.last_event || '',
    last_event_ok: boksTerbaru.last_event_ok == 1 || boksTerbaru.last_event_ok === true,
    gps_fix: boksTerbaru.gps_fix == 1 || boksTerbaru.gps_fix === true,
    sd_card_ok: boksTerbaru.sd_card_ok == null ? null : boksTerbaru.sd_card_ok == 1 || boksTerbaru.sd_card_ok === true,
    sd_sync_ok: boksTerbaru.sd_sync_ok == null ? null : boksTerbaru.sd_sync_ok == 1 || boksTerbaru.sd_sync_ok === true,
    sd_user_count: boksTerbaru.sd_user_count == null ? null : Number(boksTerbaru.sd_user_count),
    ble_scan_ok: boksTerbaru.ble_scan_ok == null ? null : boksTerbaru.ble_scan_ok == 1 || boksTerbaru.ble_scan_ok === true,
    ble_tag_count: boksTerbaru.ble_tag_count == null ? null : Number(boksTerbaru.ble_tag_count),
    supervisor_uid: boksTerbaru.supervisor_uid || '—',
    active_fuelman: boksTerbaru.active_fuelman || '',
    last_uid: boksTerbaru.last_uid || '—',
    wifi_connected: isSmoothOnline,
    telemetry_online: boksTerbaru.telemetry_online == null ? isSmoothOnline : Number(boksTerbaru.telemetry_online) === 1,
    telemetry_last_ping: boksTerbaru.telemetry_last_ping || boksTerbaru.last_ping || null,
    queue: queueFinal,
    audit_log: boksTerbaru.audit_log || [],
    uptime_ms: Number(boksTerbaru.uptime_ms || 0),
    lat: boksTerbaru.lat,
    lng: boksTerbaru.lng,
    lon: boksTerbaru.lng,
    ssid: boksTerbaru.ssid || 'Wi-Fi Hotspot'
  };
}
