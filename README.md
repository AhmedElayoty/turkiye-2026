# Türkiye 2026

Private trip companion for a two-week trip, built as an installable web app.

Everything personal in this repository is encrypted client-side (AES-256-GCM, key derived with PBKDF2-SHA256 at 600,000 iterations). The `vault/` folder contains only ciphertext. The app shell in `index.html`, `app.js` and `styles.css` contains no trip data.

The plaintext source, the raw documents and the passphrase live only in the local `build/` folder, which is git-ignored.

## Local development

```bash
python -m http.server 8000
```

then open http://localhost:8000/ and unlock with the passphrase.

## Rebuilding after a content change

```bash
cd build
python content.py
python build.py
```

then commit and push. The service worker version is stamped on every build, so installed copies pick up the update on next open.
