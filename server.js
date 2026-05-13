const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const dotenv = require("dotenv");

// ===================== ENV =====================
dotenv.config({ path: process.env.ENV_FILE || "/home/BonkDrop/bonkdrop_site/.env" });

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
const STORAGE = process.env.STORAGE_PATH || "~/bonkdrop_site/storage";
const TEMP = process.env.TEMP_PATH || "~/bonkdrop_site/temp";
const DB_FILE = process.env.DB_FILE_PATH || "~/bonkdrop_site/bonkdrop_datafiles.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024;

if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true });

// ===================== MULTER =====================
const upload = multer({
  dest: TEMP,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
});

const uploadFields = upload.fields([
  { name: "files", maxCount: 10 },
  { name: "file", maxCount: 10 }
]);

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

function folderSize() {
  return fs.readdirSync(STORAGE).reduce((a, f) => {
    return a + fs.statSync(path.join(STORAGE, f)).size;
  }, 0);
}

function collectUploadedFiles(req) {
  const files = [];

  if (req.file) {
    files.push(req.file);
  }

  if (Array.isArray(req.files)) {
    files.push(...req.files);
  }

  if (req.files && !Array.isArray(req.files) && typeof req.files === "object") {
    for (const key of Object.keys(req.files)) {
      const value = req.files[key];
      if (Array.isArray(value)) {
        files.push(...value);
      }
    }
  }

  return files.filter((file) => file && (file.fieldname === "file" || file.fieldname === "files"));
}

function storeUploadedFile(file, ip) {
  if (!file) {
    return { status: 400, body: { error: "No file" } };
  }

  if (folderSize() + file.size > MAX_STORAGE) {
    fs.unlinkSync(file.path);
    return { status: 507, body: { error: "Storage full" } };
  }

  const id = generateID();
  const token = crypto.randomBytes(16).toString("hex");
  const ext = path.extname(file.originalname);
  const filename = id + ext;

  fs.renameSync(file.path, path.join(STORAGE, filename));

  const db = readDB();
  db[id] = {
    filename,
    token,
    ip,
    createdAt: Date.now()
  };
  writeDB(db);

  return {
    status: 200,
    body: {
      id,
      token,
      url: `https://bonkdrop.fr/${id}/${token}`,
      filename
    }
  };
}

// ===================== ROUTES =====================
// accueil
app.get("/", (req, res) => {
  res.send("BonkDrop API OK");
});
// +++++++++++++++++++++ SECURITE FRONT +++++++++++++++++++++++

app.post("/api/upload", uploadFields, (req, res) => {
  const files = collectUploadedFiles(req);

  if (files.length === 0) {
    return res.status(400).json({ error: "No file" });
  }

  const result = [];

  for (const file of files) {
    const stored = storeUploadedFile(file, req.ip);
    if (stored.status !== 200) {
      return res.status(stored.status).json(stored.body);
    }
    result.push(stored.body);
  }

  return res.json({ success: true, files: result });
});

// ---------------- UPLOAD ----------------
app.post("/upload", requireApiKey, uploadFields, (req, res) => {
  const files = collectUploadedFiles(req);

  if (files.length === 0) {
    return res.status(400).json({ error: "No file" });
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  if (folderSize() + totalSize > MAX_STORAGE) {
    files.forEach((file) => fs.unlinkSync(file.path));
    return res.status(507).json({ error: "Storage full" });
  }

  const results = [];

  for (const file of files) {
    const stored = storeUploadedFile(file, req.ip);
    if (stored.status !== 200) {
      return res.status(stored.status).json(stored.body);
    }
    results.push(stored.body);
  }

  return res.json({
    success: true,
    files: results
  });
});

// ---------------- DOWNLOAD ----------------
app.get("/:id/:token", (req, res) => {

  const { id, token } = req.params;
  const db = readDB();
  const file = db[id];

  if (!file) return res.status(404).send("Not found");
  if (file.token !== token) return res.status(403).send("Invalid token");

  const filePath = path.join(STORAGE, file.filename);

  if (!fs.existsSync(filePath)) return res.status(404).send("Missing file");

  res.setHeader("Content-Disposition", "inline");
  res.sendFile(path.resolve(filePath));
});

// ---------------- DELETE ----------------
app.delete("/delete/:id/:token", (req, res) => {
  const { id, token } = req.params;
  const db = readDB();
  const file = db[id];

  if (!file) return res.status(404).json({ error: "Not found" });
  if (file.token !== token) return res.status(403).json({ error: "Invalid token" });

  const filePath = path.join(STORAGE, file.filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  delete db[id];
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
      return res.status(400).json({ error: "Invalid file field, use file or files" });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  return next(err);
});

// ===================== START =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log("BonkDrop API running on (api github fonctionne bien)", PORT);
});