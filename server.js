const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

// ===== PROXY =====
app.set("trust proxy", 1);

// ===== DOSSIERS =====
const STORAGE = "./storage";
const TEMP = "./temp";
const DB_FILE = "./files.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024;

// Init dossiers
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE);
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);

// ===== RATE LIMIT =====
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

//JSON PARTOUT SAUF /deploy
app.use((req, res, next) => {
  if (req.path === "/deploy") return next();
  express.json()(req, res, next);
});

// ===== MULTER =====
const upload = multer({
  dest: TEMP,
  limits: { fileSize: 1024 * 1024 * 1024 }
});

// ===== DB =====
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

// ===== ROUTES =====
app.get("/", (req, res) => {
  res.send("BonkDrop API fonctionne");
});

// UPLOAD
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });

  const size = getFolderSize(STORAGE);
  if (size + req.file.size > MAX_STORAGE) {
    fs.unlinkSync(req.file.path);
    return res.status(507).json({ error: "Storage full" });
  }

  const id = generateID();
  const ext = path.extname(req.file.originalname);
  const filename = id + ext;
  const finalPath = path.join(STORAGE, filename);

  fs.renameSync(req.file.path, finalPath);

  const db = readDB();
  db[id] = {
    originalName: req.file.originalname,
    filename,
    date: new Date()
  };
  writeDB(db);

  res.json({ success: true, id });
});

// GET FILE
app.get("/file/:id", (req, res) => {
  const db = readDB();
  const file = db[req.params.id];

  if (!file) return res.status(404).send("Not found");

  res.sendFile(path.resolve(path.join(STORAGE, file.filename)));
});

// ===== WEBHOOK GITHUB =====
app.post("/deploy", express.raw({ type: "application/json" }), (req, res) => {

  const event = req.headers["x-github-event"];

  // Ping GitHub
  if (event === "ping") {
    console.log("Ping GitHub reçu ");
    return res.status(200).send("pong");
  }

  const signature = req.headers["x-hub-signature-256"];
  const secret = "bonkdrop_secret_tuff";

  if (!signature) {
    return res.status(403).send("No signature");
  }

  const hmac = crypto.createHmac("sha256", secret);
  const digest = "sha256=" + hmac.update(req.body).digest("hex");

  if (signature !== digest) {
    console.log("Signature invalide ");
    return res.status(403).send("Invalid signature");
  }

  console.log("Webhook validé ");

  res.status(200).send("Deploy lancé");

  exec(
    "git pull origin prod && pm2 restart bonkdrop",
    { cwd: "/home/BonkDrop/bonkdrop_site/BonkDrop-API" },
    (err, stdout, stderr) => {
      if (err) return console.error(err);
      console.log(stdout);
      console.error(stderr);
    }
  );
});

// ===== START =====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Serveur lancé sur port 3000");
});