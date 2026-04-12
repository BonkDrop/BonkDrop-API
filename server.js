const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

// ================= CONFIG =================
const STORAGE = "./storage";
const TEMP = "./temp";
const DB_FILE = "./files.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024; // 10 GB

// create folders
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE);
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);

// ================= RATE LIMIT =================
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60
});
app.use(limiter);

// ================= MULTER =================
const upload = multer({
  dest: TEMP,
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1 GB max par fichier
  }
});

// ================= DB =================
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const crypto = require("crypto");

function generateID() {
  return crypto.randomBytes(6).toString("hex");
}

// ================= STORAGE SIZE =================
function getFolderSize(folder) {
  let total = 0;
  if (!fs.existsSync(folder)) return 0;
const files = fs.readdirSync(folder);
  for (const file of files) {
    const stats = fs.statSync(path.join(folder, file));
    total += stats.size;
  }
  return total;
}

// ================= ROUTES =================
// test
app.get("/", (req, res) => {
  res.send("Server.js marche");
});

// upload
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("Aucun fichier");

  const currentSize = getFolderSize(STORAGE);
  if (currentSize + req.file.size > MAX_STORAGE) {
    fs.unlinkSync(req.file.path);
    return res.status(507).send("Storage full");
  }

  const id = generateID();
  const ext = path.extname(req.file.originalname);
  const finalName = id + ext;
  const finalPath = path.join(STORAGE, finalName);

  // move file temp → storage
  try {
    fs.renameSync(req.file.path, finalPath);

    const db = readDB();
    db[id] = {
      originalName: req.file.originalname,
      filename: finalName,
      date: new Date()
    };
    writeDB(db);

    res.json({ success: true, id: id });
  } catch (err) {
  console.error(err);
  res.status(500).send("Erreur serveur");
}
});

app.get("/file/:id", (req, res) => {
  const db = readDB();
  const file = db[req.params.id];

  if (!file) return res.status(404).send("Not found");

  const filePath = path.join(STORAGE, file.filename);
  res.sendFile(path.resolve(filePath));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});
