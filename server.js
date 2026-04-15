const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = 3000;

// ===== CONFIGURATION PROXY (IMPORTANT POUR CLOUDFLARE) =====
app.set("trust proxy", 1);

// ===== CONFIGURATION DOSSIERS =====
const STORAGE = "./storage";
const TEMP = "./temp";
const DB_FILE = "./files.json";
const MAX_STORAGE = 10 * 1024 * 1024 * 1024; // 10 GB

// Initialisation des dossiers
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE);
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP);

// ===== RATE LIMITER =====
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limite chaque IP à 60 requêtes par minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Priorité à l'IP réelle fournie par Cloudflare
    return req.headers["cf-connecting-ip"] || 
           req.headers["x-forwarded-for"] || 
           req.ip;
  },
  message: { error: "Trop de requêtes, attendez un peu" }
});

// Middlewares globaux
app.use(limiter);
app.use(express.json());

// ===== CONFIGURATION UPLOAD (MULTER) =====
const upload = multer({
  dest: TEMP,
  limits: { fileSize: 1024 * 1024 * 1024 } // Limite 1GB par fichier
});

// ===== FONCTIONS UTILITAIRES DB =====
function readDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (err) {
    console.error("Erreur lecture DB:", err);
    return {};
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Erreur écriture DB:", err);
  }
}

function generateID() {
  return crypto.randomBytes(6).toString("hex");
}

function getFolderSize(folder) {
  if (!fs.existsSync(folder)) return 0;
  const files = fs.readdirSync(folder);
  return files.reduce((total, file) => {
    return total + fs.statSync(path.join(folder, file)).size;
  }, 0);
}

// ===== ROUTES =====

// Santé de l'API
app.get("/", (req, res) => {
  res.send("BonkDrop API fonctionne comme sur des roulettes hehehe");
});

// Route d'upload
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

  const currentSize = getFolderSize(STORAGE);
  if (currentSize + req.file.size > MAX_STORAGE) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(507).json({ error: "Espace de stockage saturé" });
  }

  const id = generateID();
  const ext = path.extname(req.file.originalname);
  const filename = id + ext;
  const finalPath = path.join(STORAGE, filename);

  try {
    fs.renameSync(req.file.path, finalPath);
    
    const db = readDB();
    db[id] = {
      originalName: req.file.originalname,
      filename: filename,
      date: new Date(),
      size: req.file.size
    };
    writeDB(db);

    res.json({ success: true, id });
  } catch (err) {
    console.error("Erreur lors de l'enregistrement:", err);
    res.status(500).json({ error: "Erreur interne lors du transfert" });
  }
});

// Récupération de fichier
app.get("/file/:id", (req, res) => {
  const db = readDB();
  const fileData = db[req.params.id];

  if (!fileData) return res.status(404).json({ error: "Fichier introuvable" });

  const filePath = path.resolve(path.join(STORAGE, fileData.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Fichier physique manquant" });

  res.sendFile(filePath);
});

// Route de déploiement (Webhook)
app.post("/deploy", (req, res) => {
  const secret = req.headers["x-secret"];

  if (secret !== "bonkdrop_secret_tuff") {
    return res.status(403).json({ error: "Accès refusé" });
  }

  console.log("Signal de déploiement reçu, mise à jour en cours...");

  // On répond avant de redémarrer pour éviter de laisser la connexion pendante
  res.json({ message: "Déploiement lancé" });

  exec(
    "git pull origin prod && pm2 restart bonkdrop",
    { cwd: "/home/BonkDrop/bonkdrop_site/BonkDrop-API" },
    (err, stdout, stderr) => {
      if (err) {
        console.error(`Erreur Deploy: ${err.message}`);
        return;
      }
      if (stderr) console.error(`Stderr Deploy: ${stderr}`);
      console.log(`Stdout Deploy: ${stdout}`);
    }
  );
});

// ===== LANCEMENT =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`---`);
  console.log(`Serveur BonkDrop lancé sur le port ${PORT}`);
  console.log(`Mode Proxy: Actif (Trust Proxy 1)`);
  console.log(`---`);
});
