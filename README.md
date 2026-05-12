# BonkDrop-API

BonkDrop-API est une API (mécanismes qui permettent à deux composants logiciels de communiquer entre eux à l'aide d'un ensemble de définitions et de protocoles) simple pour uploader et servir des fichiers, avec support du déploiement via webhook GitHub. Il a été crée pour le site web Bonkdrop (https://bonkdrop.fr/), mais le code source est disponible ici, sur Github.

## Fonctionnement

- `POST /api/upload`: upload depuis le front (pas de `x-api-key` nécessaire), accepte `file` ou `files` (multipart, max 10 fichiers).
- `POST /upload`: upload côté API (nécessite le header `x-api-key`), accepte `file` ou `files` (multipart, max 10 fichiers).
- `GET /:id/:token`: téléchargement public si le `token` correspond à l'entrée en base.
- `DELETE /delete/:id/:token`: supprime le fichier si le `token` est valide.
- `POST /deploy`: vérifie la signature du webhook GitHub puis lance la commande de déploiement (`git pull` + `pm2 restart`).
- `GET /`: route de vérification (health check).

L'application stocke les fichiers dans `./storage`, les temporaires dans `./temp`, et les métadonnées dans `./files.json`.

## Modèle de sécurité

- L'endpoint `POST /upload` est protégé par le header `x-api-key`. `POST /api/upload` est destiné au front et n'utilise pas la clé API.
- L'endpoint de déploiement est protégé par la signature HMAC GitHub (`x-hub-signature-256`).
- Un rate limit global est activé.
-- Taille maximale par fichier: 2 Go.
-- Stockage total maximal: 10 Go.
-- Rétention: les fichiers restent indéfiniment tant qu'ils ne sont pas supprimés manuellement. Aucune suppression automatique par âge n'est en place.

## Variables d'environnement requises

- `API_KEY`: valeur attendue dans `x-api-key` pour `POST /upload`.
- `GITHUB_SECRET`: utilisée pour valider la signature du webhook GitHub.
- `CORS_ORIGINS` (optionnelle): liste d'origines autorisées séparées par des virgules. Si absente, la liste par défaut inclut `https://bonkdrop.fr`, `https://www.bonkdrop.fr`, `http://localhost:3000`, `http://localhost:5173`.

Par défaut, le serveur charge le fichier d'environnement situé ici:

`/home/BonkDrop/bonkdrop_site/.env`

Ce chemin peut être modifié selon l'emplacement de votre fichier `.env`, via la variable `ENV_FILE`.

Exemple de contenu pour ce fichier `.env`:

```env
API_KEY=your_long_random_api_key
GITHUB_SECRET=your_webhook_secret
CORS_ORIGINS=https://bonkdrop.fr,https://www.bonkdrop.fr,http://localhost:5173
```

## Démarrage en local

```bash
npm install
set -a
source .env
set +a
npm start
```

Note: le serveur écoute par défaut sur le port `3000` et refuse de démarrer si `API_KEY` ou `GITHUB_SECRET` sont absents.

## Exemples d'utilisation de l'API

Uploader un fichier:

```bash
curl -X POST http://localhost:3000/upload \
	-H "x-api-key: $API_KEY" \
	-F "file=@./example.txt"
```

Réponse:

```json
{
	"success": true,
	"id": "a1b2c3d4e5f6"
}
```

Télécharger un fichier (exemple):

```bash
curl -O http://localhost:3000/<id>/<token>
```

Supprimer un fichier (exemple):

```bash
curl -X DELETE http://localhost:3000/delete/<id>/<token>
```

## Flux du webhook de déploiement

Quand GitHub envoie une requête webhook valide vers `POST /deploy`, l'API exécute:

```bash
git pull origin prod && pm2 restart bonkdrop
```

En production sur Raspberry Pi, conservez les secrets hors Git (ou dans des fichiers ignorés), et assurez-vous que PM2 reçoit les variables d'environnement au redémarrage (par exemple via une config PM2 avec `env`, ou `pm2 restart --update-env`).

## Entretien automatique

Une tâche planifiée s'exécute toutes les heures et nettoie uniquement les entrées de `files.json` dont le fichier correspondant est déjà manquant sur le disque. Elle ne supprime pas les fichiers en fonction de leur âge.

## Conditions d'utilisation

Ce projet est open source: vous pouvez réutiliser le code pour votre propre usage et héberger l'API sur votre infrastructure.

En revanche, l'utilisation de cette API sur les serveurs officiels BonkDrop nécessite une autorisation explicite du propriétaire.

Sans accord, aucune clé API n'est fournie: l'accès aux serveurs BonkDrop reste bloqué.

## Licence

MIT (voir `LICENSE`).
