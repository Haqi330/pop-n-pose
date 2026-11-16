const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const FRAMES_DIR = path.join(PUBLIC_DIR, 'frames');

[PUBLIC_DIR, UPLOADS_DIR, FRAMES_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name: name.toLowerCase(), address: iface.address });
      }
    }
  }

  const wifi = candidates.find((c) => /wi-?fi|wlan|wl\w*\d|wireless/.test(c.name));
  if (wifi) return wifi.address;

  const privateLan = candidates.find((c) =>
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c.address)
  );
  if (privateLan) return privateLan.address;

  return candidates.length ? candidates[0].address : 'localhost';
}

app.get('/api/templates', (req, res) => {
  fs.readdir(FRAMES_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Gagal membaca folder frames' });
    }
    const templates = files.filter((f) => path.extname(f).toLowerCase() === '.png');
    res.json(templates);
  });
});

app.post('/api/upload', async (req, res) => {
  try {
    const { image, imageData } = req.body || {};
    const raw = image || imageData;

    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ success: false, error: 'image wajib diisi' });
    }

    const match = raw.match(/^data:image\/png;base64,(.+)$/);
    const base64Data = match ? match[1] : raw;

    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64Data)) {
      return res.status(400).json({ success: false, error: 'Format Base64 tidak valid' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
      return res.status(400).json({ success: false, error: 'Data bukan file PNG yang valid' });
    }

    const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const filePath = path.join(UPLOADS_DIR, filename);

    await fs.promises.writeFile(filePath, buffer);

    const localIP = getLocalIP();
    const downloadUrl = `http://${localIP}:${PORT}/download/${filename}`;
    const qrCodeDataUrl = await QRCode.toDataURL(downloadUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 400
    });

    res.json({ success: true, downloadUrl, qrCodeDataUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
  }
});

app.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File tidak ditemukan' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(filePath);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Akses jaringan lokal: http://${getLocalIP()}:${PORT}`);
});
