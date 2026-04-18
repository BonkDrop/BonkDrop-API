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

if (!API_KEY || !GITHUB_SECRET) {
  console.error("Missing env vars");
  process.exit(1);
}

// ===================== SECURITY =====================
app.set("trust proxy", 1);

app.use(cors({
  origin: [
    "https://bonkdrop.fr",
    "https://www.bonkdrop.fr",
    "http://localhost:3000",
    "http://localhost:5173"
  ]
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
const STORAGE = "./storage";
const TEMP = "./temp";
const DB_FILE = "./files.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024;

if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE);
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);

// ===================== MULTER =====================
const upload = multer({
  dest: TEMP,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
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
  return JSON.parse(fs.readFileSync(DB_FILE));
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

// ===================== ROUTES =====================
app.get("/", (req, res) => {
  res.send("BonkDrop API OK");
});

// +++++++++++++++++++++ SECURITE FRONT +++++++++++++++++++++++

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const FormData = require("form-data");
  const fetch = require("node-fetch");

  const form = new FormData();
  form.append("file", fs.createReadStream(req.file.path));

  try {
    const response = await fetch("http://localhost:3000/upload", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY
      },
      body: form
    });

    const data = await response.json();

    fs.unlinkSync(req.file.path);

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Proxy error" });
  }
});

// ---------------- UPLOAD ----------------
app.post("/upload", requireApiKey, upload.single("file"), (req, res) => {

  if (!req.file) return res.status(400).json({ error: "No file" });

  if (folderSize() + req.file.size > MAX_STORAGE) {
    fs.unlinkSync(req.file.path);
    return res.status(507).json({ error: "Storage full" });
  }

  const id = generateID();
  const token = crypto.randomBytes(16).toString("hex");

  const ext = path.extname(req.file.originalname);
  const filename = id + ext;

  fs.renameSync(req.file.path, path.join(STORAGE, filename));

  const db = readDB();

  db[id] = {
    filename,
    token,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };

  writeDB(db);

  res.json({
    success: true,
    url: `https://bonkdrop.fr/${id}/${token}`,
    expiresAt: db[id].expiresAt
  });
});

// ---------------- DOWNLOAD ----------------
app.get("/:id/:token", (req, res) => {

  const { id, token } = req.params;
  const db = readDB();
  const file = db[id];

  if (!file) return res.status(404).send("Not found");
  if (file.token !== token) return res.status(403).send("Invalid token");
  if (Date.now() > file.expiresAt) return res.status(410).send("Expired");

  const filePath = path.join(STORAGE, file.filename);

  if (!fs.existsSync(filePath)) return res.status(404).send("Missing file");

  res.sendFile(path.resolve(filePath));
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

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
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
  const now = Date.now();
  let changed = false;

  for (const id in db) {
    if (now > db[id].expiresAt) {
      const filePath = path.join(STORAGE, db[id].filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      delete db[id];
      changed = true;
    }
  }

  if (changed) writeDB(db);
}, 60 * 60 * 1000);

// ===================== START =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log("BonkDrop API running on (api github fonctionne bien)", PORT);
});