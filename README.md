# BonkDrop-API

API simple pour uploader et servir des fichiers, avec support du déploiement via webhook GitHub.

## Fonctionnement

- `POST /upload`: upload un fichier (champ `file`) et retourne un identifiant court.
- `GET /file/:id`: retourne le fichier lié à cet identifiant.
- `POST /deploy`: vérifie la signature du webhook GitHub puis lance la commande de déploiement.
- `GET /`: route de vérification (health check).

L'application stocke les fichiers dans `./storage` et les métadonnées dans `./files.json`.

## Modèle de sécurité

- L'endpoint d'upload est protégé par le header `x-api-key`.
- L'endpoint de déploiement est protégé par la signature HMAC GitHub (`x-hub-signature-256`).
- Un rate limit global est activé.
- Taille maximale par fichier: 2 Go.
- Stockage total maximal: 10 Go.

## Variables d'environnement requises

- `API_KEY`: valeur attendue dans `x-api-key` pour `POST /upload`.
- `GITHUB_SECRET`: utilisée pour valider la signature du webhook GitHub.

Par défaut, le serveur charge le fichier d'environnement situé ici:

`/home/BonkDrop/bonkdrop_api/.env`

Ce chemin peut être modifié selon l'emplacement de votre fichier `.env`, via la variable `ENV_FILE`.

Exemple de contenu pour ce fichier `.env`:

```env
API_KEY=your_long_random_api_key
GITHUB_SECRET=your_webhook_secret
```

## Démarrage en local

```bash
npm install
set -a
source .env
set +a
npm start
```

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

Télécharger un fichier:

```bash
curl -O http://localhost:3000/file/a1b2c3d4e5f6
```

## Flux du webhook de déploiement

Quand GitHub envoie une requête webhook valide vers `POST /deploy`, l'API exécute:

```bash
git pull origin prod && pm2 restart bonkdrop
```

En production sur Raspberry Pi, conservez les secrets hors Git (ou dans des fichiers ignorés), et assurez-vous que PM2 reçoit les variables d'environnement au redémarrage (par exemple via une config PM2 avec `env`, ou `pm2 restart --update-env`).

## Conditions d'utilisation

Ce projet est open source: vous pouvez réutiliser le code pour votre propre usage et héberger l'API sur votre infrastructure.

En revanche, l'utilisation de cette API sur les serveurs officiels BonkDrop nécessite une autorisation explicite du propriétaire.

Sans accord, aucune clé API n'est fournie: l'accès aux serveurs BonkDrop reste bloqué.

## Licence

MIT (voir `LICENSE`).
