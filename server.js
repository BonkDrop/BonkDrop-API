const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const archiver = require("archiver");
const { exec } = require("child_process");
const os = require("os");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const dotenv = require("dotenv");

// ===================== ENV =====================
dotenv.config({ path: process.env.ENV_FILE || "/home/BonkDrop/bonkdrop_backend/.env" });

const app = express();
const PORT = 3000;

const API_KEY = process.env.API_KEY;
const GITHUB_SECRET = process.env.GITHUB_SECRET;
const CORS_ORIGINS = process.env.CORS_ORIGINS;

if (!API_KEY || !GITHUB_SECRET) {
  console.error("Missing env vars");
  process.exit(1);
}

// ===================== SECURITY =====================
app.set("trust proxy", 1);

const defaultAllowedOrigins = [
  "https://bonkdrop.fr",
  "https://www.bonkdrop.fr",
  "http://localhost:3000",
  "http://localhost:5173"
];

const allowedOrigins = CORS_ORIGINS
  ? CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  }
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60
}));

// JSON sauf webhook
app.use((req, res, next) => {
  if (req.path === "/deploy") return next();
  express.json()(req, res, next);
});

// ===================== STORAGE =====================
function expandHome(p) {
  if (typeof p !== "string") return p;
  return p.replace(/^~(?=$|\/|\\)/, os.homedir());
}

const STORAGE = expandHome(process.env.STORAGE_PATH || path.resolve("~/bonkdrop_data/storage"));
const TEMP = expandHome(process.env.TEMP_PATH || path.resolve("~/bonkdrop_data/temp"));
const DB_FILE = expandHome(process.env.DB_FILE_PATH || path.resolve("~/bonkdrop_data/files.json"));
const MAX_STORAGE = 10 * 1024 * 1024 * 1024;

if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

// ===================== MULTER =====================
const upload = multer({
  dest: TEMP,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
});

// Log des uploads pour debug (content-type et endpoint) a retirer en prod si pas nécessaire
app.use((req, res, next) => {
  if (req.path === "/api/upload" || req.path === "/upload") {
    console.log(`[${req.path}] Content-Type:`, req.headers["content-type"]);
  }
  next();
});


// ===================== AUTH =====================
function requireApiKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// ===================== DB =====================
function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function generateID() {
  return crypto.randomBytes(6).toString("hex");
}

function formatDate() {
  const now = new Date();

  return now.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function folderSize() {
  return fs.readdirSync(STORAGE).reduce((a, f) => {
    return a + fs.statSync(path.join(STORAGE, f)).size;
  }, 0);
}

function handleUpload(req, res) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files" });
  }

  const totalUploadSize = req.files.reduce((total, file) => {
    return total + file.size;
  }, 0);

  if (folderSize() + totalUploadSize > MAX_STORAGE) {

    for (const file of req.files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    return res.status(507).json({ error: "Storage full" });
  }

  const uploadId = generateID();
  const token = crypto.randomBytes(16).toString("hex");

  const zipFilename = `${uploadId}.zip`;
  const zipPath = path.join(STORAGE, zipFilename);

  const output = fs.createWriteStream(zipPath);

  const archive = archiver("zip", {
    zlib: { level: 9 }
  });

  let alreadyAnswered = false;

  output.on("close", () => {
    if (alreadyAnswered) return;
    alreadyAnswered = true;
    const db = readDB();
    for (const file of req.files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    db[uploadId] = {
      filename: zipFilename,
      token,
      createdAt: formatDate(),
      size: archive.pointer(),
      originalFiles: req.files.map(f => ({
        name: f.originalname,
        size: f.size
      })),
      uploaderIp: req.ip
    };

    writeDB(db);

    return res.json({
      success: true,
      uploadId,
      token,
      url: `https://bonkdrop.fr/${uploadId}/${token}`
    });
  });

  archive.on("error", (err) => {
    console.error(err);

    for (const file of req.files) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    alreadyAnswered = true;

    if (!res.headersSent) {
      return res.status(500).json({
        error: "Zip creation failed"
      });
    }
  });

  archive.pipe(output);

  for (const file of req.files) {

    archive.file(
      file.path,
      {
        name: file.originalname
      }
    );
  }

  archive.finalize();

}

// ===================== ROUTES =====================
// accueil
app.get("/", (req, res) => {
  res.send("API BonkDrop online mais kestufous la ? si tu veux tester l'upload, va sur <a href=\"https://bonkdrop.fr\">BonkDrop</a> mais si tu t'y connais va faire une pr sur le repo au lieu de te balader ici ~~");
});
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    time: Date.now()
  });
});

// +++++++++++++++++++++ SECURITE FRONT +++++++++++++++++++++++

app.post("/api/upload", upload.array("file", 1000), handleUpload);

// ---------------- UPLOAD ----------------
app.post("/upload", requireApiKey, upload.array("file", 1000), handleUpload);

// ---------------- DOWNLOAD ----------------
app.get("/:uploadId/:token", (req, res) => {
  const { uploadId, token } = req.params;
  const db = readDB();
  const uploadData = db[uploadId];

  if (!uploadData) return res.redirect("https://bonkdrop.fr/notfound.html");
  if (uploadData.token !== token) return res.status(403).send("Invalid token");

  const zipPath = path.join(STORAGE, uploadData.filename);
  if (!fs.existsSync(zipPath)) return res.status(404).send("File not found");

  return res.download(zipPath, `bonkdrop-${uploadId}.zip`);
});
// ---------------- DELETE ----------------
app.delete("/delete/:uploadId/:token", (req, res) => {
  const { uploadId, token } = req.params;
  const db = readDB();
  const upload = db[uploadId];

  if (!upload) return res.status(404).json({ error: "Not found" });
  if (upload.token !== token) return res.status(403).json({ error: "Invalid token" });

  const filePath = path.join(STORAGE, upload.filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  delete db[uploadId];
  writeDB(db);

  return res.json({ success: true });
});

// ---------------- WEBHOOK ----------------
app.post("/deploy", express.raw({ type: "*/*" }), (req, res) => {

  const event = req.headers["x-github-event"];
  if (event === "ping") return res.status(200).send("pong");

  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return res.status(403).send("No signature");

  const digest =
    "sha256=" +
    crypto.createHmac("sha256", GITHUB_SECRET).update(req.body).digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const digestBuffer = Buffer.from(digest);

  if (
    signatureBuffer.length !== digestBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, digestBuffer)
  ) {
    return res.status(403).send("Invalid signature");
  }

  res.status(200).send("Deploy started");

  exec("git pull origin prod && pm2 restart bonkdrop", {
    cwd: "/home/BonkDrop/bonkdrop_site/BonkDrop-API"
  });
});

// ---------------- CLEANUP ----------------
setInterval(() => {
  const db = readDB();
  let changed = false;

  for (const id in db) {
    const file = db[id];
    const filePath = path.join(STORAGE, file.filename);

    // supprime juste les entrées cassées
    if (!fs.existsSync(filePath)) {
      delete db[id];
      changed = true;
      console.log("Clean DB:", id);
    }
  }

  if (changed) writeDB(db);

}, 60 * 60 * 1000);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large (max 2GB)" });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      console.error(`[ERROR] LIMIT_UNEXPECTED_FILE on ${req.path}:`, err.field, "- expected 'file'");
      return res.status(400).json({ error: "Invalid file field, expected 'file'" });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  return next(err);
});

// ======================== Route api delete =========================

app.delete("/api/delete", async (req, res) => {
    const { uploadId, token } = req.body;

    console.log(uploadId);
    console.log(token);

    res.json({
        success: true
    });
});

// ===================== Tests de verif de debug =====================

// ===================== START =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log("BonkDrop API running on (pareil comment t arrivé la sale fou ??? viens me dm sur discord la au lieu d'essayer de me detruire)", PORT);
});
