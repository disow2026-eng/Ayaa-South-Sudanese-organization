'use strict';

const express    = require('express');
const multer     = require('multer');
const fs         = require('fs').promises;
const path       = require('path');
const https      = require('https');
const http       = require('http');
const session    = require('express-session');

const app      = express();
const PORT     = 3001;
const SITE_DIR = path.resolve(__dirname, '..');          // parent = website root
const CFG_FILE = path.join(__dirname, 'config.json');

// ── Config ─────────────────────────────────────────────────────
let config = { password: 'ayaa2024', netlifyHookUrl: '' };

async function loadConfig() {
  try {
    const raw = await fs.readFile(CFG_FILE, 'utf8');
    config = { ...config, ...JSON.parse(raw) };
  } catch { /* first run — use defaults */ }
}
async function saveConfig() {
  await fs.writeFile(CFG_FILE, JSON.stringify(config, null, 2));
}

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'ayaa-admin-secret-do-not-share',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }   // 24 h
}));

// Serve admin UI at /admin
app.get('/admin', (req, res) => res.redirect('/admin/'));
app.use('/admin', express.static(path.join(__dirname, 'public')));

// Serve website files inside the iframe (same origin → editable)
app.use('/site', express.static(SITE_DIR, { index: false }));

// Serve main website at root
app.use('/', express.static(SITE_DIR, { index: 'index.html' }));

// ── Auth ────────────────────────────────────────────────────────
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

// ── Pages ───────────────────────────────────────────────────────
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
  try { await fs.copyFile(file, file + '.bak'); } catch { /* no backup if new */ }
  await fs.writeFile(file, req.body.content, 'utf8');
  res.json({ ok: true });
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
        <p class="footer__copyright">&copy; 2025 AYAA South Sudanese Community Organization. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script src="js/main.js"></script>
</body>
</html>`);
  }
  res.json({ name: safeName });
});

app.delete('/api/page/:name', auth, async (req, res) => {
  const file = path.join(SITE_DIR, path.basename(req.params.name));
  await fs.rename(file, file + '.deleted');
  res.json({ ok: true });
});

// Sync nav HTML across all pages
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
});

// ── Images ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: SITE_DIR,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-').toLowerCase())
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) =>
    /\/(image|video)\//i.test(file.mimetype) ? cb(null, true) : cb(new Error('Images and videos only')),
  limits: { fileSize: 500 * 1024 * 1024 }  // 500 MB for videos
});

app.post('/api/images', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.json({ name: req.file.filename });
});

app.get('/api/images', auth, async (req, res) => {
  const files = await fs.readdir(SITE_DIR);
  res.json(files.filter(f => /\.(jpe?g|png|gif|webp|svg|avif|WEBP|mp4|webm|mov|m4v|avi)$/i.test(f)));
});

app.delete('/api/images/:name', auth, async (req, res) => {
  await fs.unlink(path.join(SITE_DIR, path.basename(req.params.name)));
  res.json({ ok: true });
});

// ── Deploy ──────────────────────────────────────────────────────
app.post('/api/deploy', auth, (req, res) => {
  const hookUrl = req.body.hookUrl || config.netlifyHookUrl;
  if (!hookUrl) return res.status(400).json({ error: 'No Netlify deploy hook URL set' });

  try {
    const url    = new URL(hookUrl);
    const mod    = url.protocol === 'https:' ? https : http;
    const reqOut = mod.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Length': 0 } },
      r => {
        let body = '';
        r.on('data', d => (body += d));
        r.on('end', () => {
          if (r.statusCode < 300) res.json({ ok: true });
          else res.status(500).json({ error: `Hook returned ${r.statusCode}: ${body}` });
        });
      }
    );
    reqOut.on('error', err => res.status(500).json({ error: err.message }));
    reqOut.end();
  } catch (err) {
    res.status(400).json({ error: 'Invalid hook URL: ' + err.message });
  }
});

// ── Settings ────────────────────────────────────────────────────
app.get('/api/settings', auth, async (req, res) => {
  await loadConfig();
  res.json({ netlifyHookUrl: config.netlifyHookUrl });
});

app.post('/api/settings', auth, async (req, res) => {
  await loadConfig();
  if (req.body.netlifyHookUrl !== undefined) config.netlifyHookUrl = req.body.netlifyHookUrl;
  if (req.body.newPassword)                  config.password        = req.body.newPassword;
  await saveConfig();
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────────────────────
loadConfig().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  AYAA Admin Panel  →  http://localhost:${PORT}/admin`);
    console.log(`    Default password : ${config.password}`);
    console.log(`    Site folder      : ${SITE_DIR}\n`);
  });
});
