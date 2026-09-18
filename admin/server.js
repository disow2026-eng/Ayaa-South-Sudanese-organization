'use strict';

const express    = require('express');
const multer     = require('multer');
const fs         = require('fs').promises;
const fss        = require('fs');
const path       = require('path');
const https      = require('https');
const http       = require('http');
const session    = require('express-session');
const archiver   = require('archiver');

const app      = express();
const PORT     = process.env.PORT || 3001;
const SITE_DIR = path.resolve(__dirname, '..');
const CFG_FILE = path.join(__dirname, 'config.json');

// ── Config ──────────────────────────────────────────────────────
let config = { password: 'ayaa2024' };

async function loadConfig() {
  try {
    const raw = await fs.readFile(CFG_FILE, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  } catch { /* first run */ }
}
async function saveConfig() {
  await fs.writeFile(CFG_FILE, JSON.stringify(config, null, 2));
}

// ── Netlify deploy ───────────────────────────────────────────────
// Set these in Railway environment variables:
//   NETLIFY_TOKEN   — Netlify personal access token
//   NETLIFY_SITE_ID — Netlify site ID
async function netlifyDeploy() {
  const token  = process.env.NETLIFY_TOKEN;
  const siteId = process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) {
    console.warn('Netlify deploy skipped — NETLIFY_TOKEN or NETLIFY_SITE_ID not set');
    return;
  }

  console.log('Packaging site for Netlify deploy...');

  // Build zip in memory
  const zipBuffer = await new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks  = [];
    archive.on('data',  c => chunks.push(c));
    archive.on('end',   () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Add all site files except admin/, .bak, .deleted, .git, node_modules
    archive.glob('**/*', {
      cwd: SITE_DIR,
      ignore: [
        'admin/**',
        '**/*.bak',
        '**/*.deleted',
        '.git/**',
        'node_modules/**',
        '*.nosync'
      ],
      dot: false
    });

    archive.finalize();
  });

  // POST zip to Netlify file-based deploy API
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.netlify.com',
      path:     `/api/v1/sites/${siteId}/deploys`,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/zip',
        'Content-Length': zipBuffer.length
      }
    }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        if (res.statusCode < 300) {
          console.log('Netlify deploy triggered successfully');
          resolve();
        } else {
          console.error('Netlify deploy failed:', res.statusCode, body);
          reject(new Error(`Netlify ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(zipBuffer);
    req.end();
  });
}

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'ayaa-admin-secret-do-not-share',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Debug route — remove after fixing
app.get('/debug', async (req, res) => {
  const fssSync = require('fs');
  const adminPublic = path.join(__dirname, 'public');
  const info = {
    __dirname,
    SITE_DIR,
    adminPublicExists: fssSync.existsSync(adminPublic),
    adminIndexExists:  fssSync.existsSync(path.join(adminPublic, 'index.html')),
    siteFiles: fssSync.existsSync(SITE_DIR) ? fssSync.readdirSync(SITE_DIR).slice(0, 20) : 'NOT FOUND'
  };
  res.json(info);
});

// Serve admin UI
const ADMIN_HTML = path.join(__dirname, 'public', 'index.html');
app.get('/admin',  (req, res) => res.sendFile(ADMIN_HTML));
app.get('/admin/', (req, res) => res.sendFile(ADMIN_HTML));
app.use('/admin/assets', express.static(path.join(__dirname, 'public')));

// Serve site files for iframe preview
app.use('/site', express.static(SITE_DIR, { index: false }));

// Serve main website at root
app.use('/', express.static(SITE_DIR, { index: 'index.html' }));

// ── Auth ─────────────────────────────────────────────────────────
const auth = (req, res, next) =>
  req.session.authenticated ? next() : res.status(401).json({ error: 'Unauthorized' });

app.get('/api/auth', (req, res) =>
  res.json({ ok: !!req.session.authenticated }));

app.post('/api/login', async (req, res) => {
  await loadConfig();
  if (req.body.password === config.password) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── Pages ────────────────────────────────────────────────────────
app.get('/api/pages', auth, async (req, res) => {
  const files = await fs.readdir(SITE_DIR);
  res.json(files.filter(f => f.endsWith('.html') && !f.startsWith('_')));
});

app.get('/api/page/:name', auth, async (req, res) => {
  const file = path.join(SITE_DIR, path.basename(req.params.name));
  const content = await fs.readFile(file, 'utf8');
  res.json({ content });
});

app.post('/api/page/:name', auth, async (req, res) => {
  const file = path.join(SITE_DIR, path.basename(req.params.name));
  try { await fs.copyFile(file, file + '.bak'); } catch {}
  await fs.writeFile(file, req.body.content, 'utf8');
  res.json({ ok: true });
  // Deploy to Netlify in background — client sees save instantly
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

app.post('/api/page-new', auth, async (req, res) => {
  const { name, copyFrom } = req.body;
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '') + '.html';
  const dest = path.join(SITE_DIR, safeName);
  if (copyFrom) {
    await fs.copyFile(path.join(SITE_DIR, path.basename(copyFrom)), dest);
  } else {
    await fs.writeFile(dest, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Page — AYAA</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <nav class="navbar" role="navigation" aria-label="Main navigation">
    <div class="container">
      <div class="navbar__inner">
        <a href="index.html" class="navbar__logo" aria-label="AYAA Home">
          <span class="navbar__logo-name">AYAA</span>
          <span class="navbar__logo-sub">South Sudanese Community Org.</span>
        </a>
        <ul class="navbar__nav">
          <li><a href="index.html" class="navbar__link">Home</a></li>
          <li><a href="about.html" class="navbar__link">About</a></li>
          <li><a href="programs.html" class="navbar__link">Programs</a></li>
          <li><a href="school.html" class="navbar__link">The School</a></li>
          <li><a href="contact.html" class="navbar__link">Contact</a></li>
        </ul>
        <div class="navbar__cta">
          <a href="donate.html" class="btn btn--primary">Donate Now</a>
        </div>
        <button class="navbar__hamburger" aria-label="Open menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
  </nav>
  <section class="section">
    <div class="container">
      <span class="section-label">New Page</span>
      <h1 class="section-title">Page Title</h1>
      <div class="divider"></div>
      <p>Start editing this page from the admin panel.</p>
    </div>
  </section>
  <footer class="footer">
    <div class="flag-bar"></div>
    <div class="container">
      <div class="footer__bottom">
        <p class="footer__copyright">&copy; 2026 AYAA South Sudanese Community Organization. All rights reserved.</p>
      </div>
    </div>
  </footer>
  <script src="js/main.js"></script>
</body>
</html>`);
  }
  res.json({ name: safeName });
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

app.delete('/api/page/:name', auth, async (req, res) => {
  const file = path.join(SITE_DIR, path.basename(req.params.name));
  await fs.rename(file, file + '.deleted');
  res.json({ ok: true });
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

// Sync nav across all pages
app.post('/api/nav-sync', auth, async (req, res) => {
  const { navHTML } = req.body;
  const files = await fs.readdir(SITE_DIR);
  const pages = files.filter(f => f.endsWith('.html') && !f.startsWith('_'));
  const updated = [];
  for (const page of pages) {
    const file = path.join(SITE_DIR, page);
    let content = await fs.readFile(file, 'utf8');
    const before = content;
    content = content.replace(
      /(<ul\s[^>]*class="navbar__nav"[^>]*>)[\s\S]*?(<\/ul>)/,
      `$1\n${navHTML}\n      $2`
    );
    if (content !== before) {
      try { await fs.copyFile(file, file + '.bak'); } catch {}
      await fs.writeFile(file, content, 'utf8');
      updated.push(page);
    }
  }
  res.json({ ok: true, updated });
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

// ── Images ───────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: SITE_DIR,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-').toLowerCase())
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) =>
    /\/(image|video)\//i.test(file.mimetype) ? cb(null, true) : cb(new Error('Images and videos only')),
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.post('/api/images', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.json({ name: req.file.filename });
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

app.get('/api/images', auth, async (req, res) => {
  const files = await fs.readdir(SITE_DIR);
  res.json(files.filter(f => /\.(jpe?g|png|gif|webp|svg|avif|WEBP|mp4|webm|mov|m4v|avi)$/i.test(f)));
});

app.delete('/api/images/:name', auth, async (req, res) => {
  await fs.unlink(path.join(SITE_DIR, path.basename(req.params.name)));
  res.json({ ok: true });
  netlifyDeploy().catch(err => console.error('Deploy error:', err.message));
});

// Manual deploy trigger from admin UI
app.post('/api/deploy', auth, async (req, res) => {
  try {
    await netlifyDeploy();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ─────────────────────────────────────────────────────
app.get('/api/settings', auth, async (req, res) => {
  await loadConfig();
  res.json({});
});

app.post('/api/settings', auth, async (req, res) => {
  await loadConfig();
  if (req.body.newPassword) config.password = req.body.newPassword;
  await saveConfig();
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────
loadConfig().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  AYAA Admin Panel  →  http://localhost:${PORT}/admin`);
    console.log(`    Default password : ${config.password}`);
    console.log(`    Site folder      : ${SITE_DIR}\n`);
  });
});
