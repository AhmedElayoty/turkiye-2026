# Türkiye 2026

Private trip companion, built as an installable web app.

- **Today** follows the clock: the next trip (tap Done to move on), the day's map, food, costs, your notes and what to check.
- **Days**: every day with its route map, numbered trips, plan, places, costs, and the documents and notes you added.
- **Ask**: a trip assistant. Offline it answers from the plan on the phone; with the free smart chat switched on it is Google Gemini, which can also read documents, make PDFs, log spending, add to-dos and notes, and judge insurance cases. Every answer can be saved as a PDF.
- **Docs**: tickets, bookings, insurance, the full plan, route maps and one-tap PDFs. **Add a document** (PDF, photo or screenshot): the app reads it, finds the day and trip it belongs to, and files it there.
- **More**: money log and converter, food and drink, ferries and taxis, phrases and driver cards, checklist, tips, emergency and insurance, settings.

## Privacy

Everything personal is encrypted in the browser (AES-256-GCM, key derived with PBKDF2-SHA256 at 600,000 iterations). The `vault/` folder holds only ciphertext under opaque names; which file is which is recorded inside the encrypted content. The app code contains no trip details: names, dates, flights, hotels and plans all come from the vault after unlocking.

**Cloud sync.** Everything added on a phone (documents, notes, own to-dos, spending, ticks, settings and keys) is one object encrypted with the same key. It is kept in IndexedDB and synced to the `cloud` branch of this repository (`mine.enc` and `files/*.enc`, ciphertext only) through the GitHub REST API with a fine-grained token that the traveller pastes once in Settings; the token itself travels inside the encrypted object, so every device that unlocks with the passphrase can read and save. Entries carry change times and deletions leave tombstones, so two phones merge without losing anything. Settings also makes an encrypted backup file.

**Smart chat (optional, free).** The chat can use Google Gemini with a free Google AI Studio key (no billing), pasted once in Settings and synced like everything else. While it is on, questions, the trip plan and added documents are sent to Google to produce answers; on the free tier Google may use them to improve its products. Without a key, or offline, the built-in assistant answers.

The plaintext content, the raw documents, the generator and the passphrase live only in the local `build/` folder, which is git-ignored.

## Local development

```bash
python build/build_v2.py --test ../qa_app     # full copy with a throwaway test passphrase
python -m http.server 8766 --directory ../qa_app
```

Open `http://localhost:8766/?today=YYYY-MM-DD&time=HH:MM` to pretend it is that day and time. Test copies (only) accept `&aibase=http://127.0.0.1:PORT` and `&ghbase=http://127.0.0.1:PORT` to point the AI and the cloud at local mock APIs.

## Rebuilding after a content change

```bash
python build/generator/content_v2.py build/content.json
python build/build_v2.py
```

then commit and push in one commit. The build stamps `sw.js`, `index.html` and `version.json`; installed copies show "A new version is ready".
