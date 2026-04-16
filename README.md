# BonkDrop-API
BonkDrop API for files transferts

## Environment variables

This API requires these environment variables:

- API_KEY
- GITHUB_SECRET

Example:

```bash
API_KEY="your_long_api_key"
GITHUB_SECRET="your_webhook_secret"
npm start
```

For PM2 on Raspberry Pi, set these variables in your PM2 ecosystem config (or in the shell before starting PM2), so `pm2 restart` keeps working after each deploy.
