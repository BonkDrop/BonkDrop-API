const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const pool = require("./db");

function sanitizeUsername(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

async function buildUniqueUsername(profile, email) {
  const emailBase = email.split("@")[0] || "user";
  const base = sanitizeUsername(profile.displayName) || sanitizeUsername(emailBase) || "user";

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = attempt === 0 ? "" : `${Math.floor(Math.random() * 9000) + 1000}`;
    const candidate = `${base}${suffix}`.slice(0, 24);

    const existing = await pool.query(
      "SELECT id FROM users WHERE username = $1 LIMIT 1",
      [candidate]
    );

    if (existing.rows.length === 0) {
      return candidate;
    }
  }

  return `user${Date.now()}`;
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "https://bonkdrop.fr/auth/google/callback"
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile?.emails?.[0]?.value?.toLowerCase();
        const avatarUrl = profile?.photos?.[0]?.value || null;

        if (!email) {
          return done(new Error("Google account email is missing"), null);
        }

        const existingUser = await pool.query(
          `SELECT
            id,
            username,
            email,
            avatar_url,
            provider,
            email_verified,
            created_at
          FROM users
          WHERE email = $1
          LIMIT 1`,
          [email]
        );

        if (existingUser.rows.length > 0) {
          const updatedUser = await pool.query(
            `UPDATE users
            SET
              avatar_url = COALESCE($1, avatar_url),
              provider = 'google',
              provider_id = $2,
              email_verified = true
            WHERE id = $3
            RETURNING
              id,
              username,
              email,
              avatar_url,
              provider,
              email_verified,
              created_at`,
            [avatarUrl, profile.id, existingUser.rows[0].id]
          );

          return done(null, updatedUser.rows[0]);
        }

        const username = await buildUniqueUsername(profile, email);
        const randomPassword = crypto.randomBytes(32).toString("hex");
        const passwordHash = await bcrypt.hash(randomPassword, 12);

        const createdUser = await pool.query(
          `INSERT INTO users
          (username, email, password_hash, avatar_url, provider, provider_id, email_verified)
          VALUES ($1, $2, $3, $4, 'google', $5, true)
          RETURNING
            id,
            username,
            email,
            avatar_url,
            provider,
            email_verified,
            created_at`,
          [username, email, passwordHash, avatarUrl, profile.id]
        );

        return done(null, createdUser.rows[0]);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);