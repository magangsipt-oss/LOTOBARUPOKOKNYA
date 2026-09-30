const fs = require('fs');
let code = fs.readFileSync('controllers/boxController.js', 'utf8');
code = code.replace(
  /const hardware = JSON\.stringify\(\{ \.\.\.previousHardware, \.\.\.status \}\);/,
  `const hardware = JSON.stringify({ ...previousHardware, ...status });

    if (status.last_uid && typeof status.last_uid === 'string' && status.last_uid.length >= 8 && status.last_uid !== '---') {
      if (status.state === 'REGISTER' || status.state === 'WELCOME' || status.state === 'STATE_REGISTER_RFID' || status.state === 'STATE_WELCOME') {
        pool.query('SELECT id FROM rfid_buffer WHERE id_box = ? AND rfid_uid = ? LIMIT 1', [box.id_box, status.last_uid]).then(([bufferCheck]) => {
          if (!bufferCheck.length) {
            pool.query('INSERT INTO rfid_buffer (id_box, rfid_uid) VALUES (?, ?)', [box.id_box, status.last_uid]);
            console.log('[PULL WORKAROUND] Inserted new card into buffer: ' + status.last_uid);
          }
        });
      }
    }`
);
fs.writeFileSync('controllers/boxController.js', code);
console.log('Patch applied!');
