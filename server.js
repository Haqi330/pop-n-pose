const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const FRAMES_DIR = path.join(PUBLIC_DIR, 'frames');

[PUBLIC_DIR, FRAMES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(express.static(PUBLIC_DIR));

app.get('/api/templates', (req, res) => {
  fs.readdir(FRAMES_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Gagal membaca folder frames' });
    }
    res.json(files.filter((f) => path.extname(f).toLowerCase() === '.png'));
  });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
