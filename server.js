const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const dotenv = require("dotenv");

const DEFAULT_ENV_PATH = "/home/BonkDrop/bonkdrop_site/.env";
dotenv.config({ path: process.env.ENV_FILE || DEFAULT_ENV_PATH });

const app = express();
const PORT = 3000;

// ===================== SECURITY =====================
const API_KEY = process.env.API_KEY;
const GITHUB_SECRET = process.env.GITHUB_SECRET;

if (!API_KEY || !GITHUB_SECRET) {
  console.error("Missing required env vars");
  process.exit(1);
}

// ===================== PROXY =====================
app.set("trust proxy", 1);

// ===================== CORS =====================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));

// ===================== RATE LIMIT =====================
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60
});
app.use(limiter);

// ===================== BODY =====================
app.use((req, res, next) => {
  if (req.path === "/deploy") return next();
  express.json()(req, res, next);
});

// ===================== MULTER =====================
const upload = multer({
  dest: "./temp",
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB
  }
});

// ===================== STORAGE =====================
const STORAGE = "./storage";
const TEMP = "./temp";
const DB_FILE = "./files.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024;

if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE);
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);

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

function getFolderSize(folder) {
  if (!fs.existsSync(folder)) return 0;

  return fs.readdirSync(folder).reduce((total, file) => {
    return total + fs.statSync(path.join(folder, file)).size;
  }, 0);
}

// ===================== ROUTES =====================
app.get("/", (req, res) => {
  res.send("BonkDrop API OK 🚀");
});

// --------------------- UPLOAD ---------------------
app.post("/upload", requireApiKey, upload.single("file"), (req, res) => {

  if (!req.file) {
    return res.status(400).json({ error: "No file" });
  }

  const size = getFolderSize(STORAGE);

  if (size + req.file.size > MAX_STORAGE) {
    fs.unlinkSync(req.file.path);
    return res.status(507).json({ error: "Storage full" });
  }

  const id = generateID();
  const token = crypto.randomBytes(8).toString("hex");

  const ext = path.extname(req.file.originalname);
  const filename = id + ext;

  fs.renameSync(req.file.path, path.join(STORAGE, filename));

  const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

  const db = readDB();
  db[id] = {
    originalName: req.file.originalname,
    filename,
    token,
    createdAt: Date.now(),
    expiresAt
  };

  writeDB(db);

  res.json({
    success: true,
    url: `https://bonkdrop.fr/${id}/${token}`,
    expiresAt
  });
});

// --------------------- DOWNLOAD SECURE ---------------------
app.get("/:id/:token", (req, res) => {

  const { id, token } = req.params;

  const db = readDB();
  const file = db[id];

  if (!file) {
    return res.status(404).send("Not found");
  }

  if (file.token !== token) {
    return res.status(403).send("Invalid link");
  }

  if (Date.now() > file.expiresAt) {
    return res.status(410).send("Expired");
  }

  const filePath = path.join(STORAGE, file.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Missing file");
  }

  res.sendFile(path.resolve(filePath));
});

// --------------------- WEBHOOK ---------------------
app.post("/deploy", express.raw({ type: "*/*" }), (req, res) => {

  const event = req.headers["x-github-event"];

  if (event === "ping") {
    return res.status(200).send("pong");
  }

  const signature = req.headers["x-hub-signature-256"];

  if (!signature) {
    return res.status(403).send("No signature");
  }

  const hmac = crypto.createHmac("sha256", GITHUB_SECRET);
  const digest = "sha256=" + hmac.update(req.body).digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );

  if (!valid) {
    return res.status(403).send("Invalid signature");
  }

  res.status(200).send("Deploy started");

  exec("nohup /home/BonkDrop/deploy.sh > /dev/null 2>&1 &");
});

// --------------------- CLEANUP ---------------------
setInterval(() => {
  console.log("Cleanup...");

  const db = readDB();
  const now = Date.now();
  let changed = false;

  for (const id in db) {
    const file = db[id];

    if (now > file.expiresAt) {
      const filePath = path.join(STORAGE, file.filename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      delete db[id];
      changed = true;

      console.log("Deleted:", id);
    }
  }

  if (changed) writeDB(db);

}, 60 * 60 * 1000);

// ===================== START =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log("BonkDrop API running on port (api git bonne)", PORT);
});
