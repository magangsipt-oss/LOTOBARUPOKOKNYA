const deny = res => res.status(403).json({ success: false, message: 'Anda tidak memiliki izin untuk tindakan ini.' });

// This gate is mounted at /api after authentication. Unknown device operations fail closed.
export default function authorization(req, res, next) {
  let route;
  try { route = decodeURIComponent(req.path).replace(/\/$/, '') || '/'; }
  catch { return res.status(400).json({ success: false, message: 'Path tidak valid.' }); }
  const read = ['GET', 'HEAD'].includes(req.method);
  if (req.auth.type === 'device') {
    const box = req.auth.boxId;
    if (req.method === 'POST' && route === '/users/check-card') return next();
    if (read && (route === '/users' || route.startsWith('/users/photo/'))) return next();
    if (req.method === 'POST' && route === `/boxes/${box}/telemetry` &&
        (req.body?.id_box === undefined || req.body.id_box === box)) return next();
    if (read && route === '/logs/tapping-history/stats' && (req.query.id_box || req.query.idBox) === box) return next();
    if (req.method === 'POST' && route === '/logs/people-counting' && req.body?.id_box === box) return next();
    if (req.method === 'POST' && route === '/loto/presence' && req.body?.id_box === box) return next();
    if (read && route === `/commands/${box}/pending`) return next();
    if (req.method === 'PATCH' && route === `/commands/${box}/clear`) return next();
    return deny(res);
  }
  if (read) return next();
  const { role, user } = req.auth;
  if (route === '/users/logout' || route === '/users/password') return next();
  // Telemetry and counting are device-originated, even for administrators.
  if (/^\/boxes\/[^/]+\/(telemetry|state)$/.test(route) || route === '/logs/people-counting' || route === '/loto/presence') return deny(res);
  if (role === 'admin') return next();
  if (req.method === 'PUT' && route === `/users/${user.sid}`) {
    // Profile edits cannot assign roles, badges or fingerprints.
    const keys = Object.keys(req.body || {});
    if (keys.some(k => !['nama', 'name', 'foto', 'profile_photo'].includes(k)) || req.is('multipart/form-data')) return deny(res);
    return next();
  }
  if (role === 'pengawas' && req.method === 'POST' && route === '/supervisor/team' && req.body?.supervisor_sid === user.sid) return next();
  if (['pengawas', 'teknisi'].includes(role) && req.method === 'POST' && route === '/maintenance') return next();
  return deny(res);
}
