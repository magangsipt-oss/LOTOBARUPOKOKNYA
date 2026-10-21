// Notifikasi live ke dashboard: tiap penulisan data yang berhasil (terutama dari box LOTO)
// dikirim lewat Server-Sent Events agar browser langsung memuat ulang datanya.
const clients = new Map(); // res -> timer heartbeat
const MAX_CLIENTS = 200;
const HEARTBEAT_MS = 25000;

export function subscribe(req, res) {
  if (clients.size >= MAX_CLIENTS) {
    return res.status(503).json({ success: false, message: 'Terlalu banyak koneksi live.' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // Nginx tidak boleh menahan event di buffer proxy.
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');
  clients.set(res, setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS));
  req.on('close', () => {
    clearInterval(clients.get(res));
    clients.delete(res);
  });
}

export function publish(change) {
  const frame = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
  for (const res of clients.keys()) res.write(frame);
}

// Tutup semua stream agar server.close() tidak menunggu koneksi live.
export function closeAll() {
  for (const [res, heartbeat] of clients) {
    clearInterval(heartbeat);
    res.end();
  }
  clients.clear();
}

export function announceChanges(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const device = req.auth?.type === 'device';
    const box = device ? req.auth.boxId : req.body?.id_box;
    publish({
      source: device ? 'device' : 'user',
      id_box: typeof box === 'string' ? box : null,
      at: Date.now()
    });
  });
  next();
}

export const liveClientCount = () => clients.size;
