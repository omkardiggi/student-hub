# Omkar Hub — turn any doubt into a lesson

Ask by **text, photo, or voice** → the AI writes a slide deck (title, flowchart, diagram,
explanation) → an **AI tutor narrates it** slide-by-slide in **English / Hindi / Kannada**,
with your teacher video playing. Save every doubt to a revision library.

This is a **real, working** full-stack app — not a mockup. The doubt→deck→narration loop
runs the moment you add a free Groq key.

---

## 🎓 AI Teacher — immersive classroom

Every lesson has two ways to learn, right under the deck in **Ask a doubt**:

1. **Quick Answer** — press play, the tutor narrates the deck (as before).
2. **🎓 Learn with AI Teacher** — opens a **fullscreen classroom overlay** *over* the
   dashboard (never navigates away). A realistic animated professor teaches you on a green
   board with animated HTML slides, real **audio-driven lip-sync**, blinking, breathing,
   head-turns toward the board/student, and pointing gestures.

**What it does**
- Reuses the existing `generateLesson()` slides + narration and the dashboard's `slideHTML()`
  renderer — **zero duplicate slide code**; the board matches your deck exactly.
- Speaks with the **same `/api/tts` neural voice** as the dashboard tutor (English / Hindi /
  Kannada), falling back to browser voices offline.
- **Interrupt & ask** (🎤 mic): pause the class, ask a follow-up, the teacher answers on the
  board (`/api/ask-teacher`), then the lesson resumes.
- **Wrap-up** (`/api/lesson-extras`): summary, key points, flip-flashcards, practice questions,
  and a coding exercise when the topic is programming.
- Controls: play/pause, prev/next, replay slide, playback speed, fullscreen, exit, quiz
  (reuses `/api/practice`), download notes (`.txt`) and slides (reuses `/api/deck-file` `.pptx`).

**How the teacher is rendered (and stays fast)**
- Base: an always-works **animated SVG professor** — no downloads, instant.
- Progressive upgrade: **Three.js + a Ready Player Me GLB avatar** (`teacher3d.js`), loaded
  **lazily only when you click** *Learn with AI Teacher*. If WebGL or the avatar fails, it
  silently keeps the SVG teacher — the classroom never breaks.
- Swap the avatar without code: set `window.OMKAR_AVATAR_URL = 'https://models.readyplayer.me/<id>.glb'`.
- **Photoreal upgrade path** (documented in `teacher3d.js`): run Unreal Engine **MetaHuman +
  Audio2Face** via Pixel Streaming on a GPU host and swap the `<canvas>` for its WebRTC
  `<video>` — the same `setSpeaking / lookAt / gesture` interface maps straight onto it.

**Files** — new: `public/classroom.css`, `public/classroom.js`, `public/teacher3d.js`.
Backend additions: `answerFollowup()` + `generateLessonExtras()` in `lib/groq.js`, routes
`/api/ask-teacher` and `/api/lesson-extras` in `server.js`. Nothing existing was removed.

---

## 1. Run it (3 steps)

```bash
npm install
cp .env.example .env      # then open .env and paste your OWN keys
npm start                 # → http://localhost:3000
```

You need **Node 18+**. Open the site, click **Try it free**, create an account, ask a doubt.

---

## 2. Get your keys (all free)

| Key | Where | Needed for |
|-----|-------|-----------|
| `GROQ_API_KEY` | console.groq.com/keys (no card) | lessons, photo-reading, voice-to-text, debate judging |

That is the **only** key you need. The **downloadable .pptx is built locally** (pptxgenjs) with
slide images pulled from **Pollinations** (free, no key), and **live debate video** runs on
**PeerJS's free public broker** (no key). Keys live only in `.env`, which is git-ignored and
never sent to the browser.

> The key you called "Grok" starting with `gsk_` is a **Groq** key (Groq = fast inference,
> Grok = xAI's chatbot — unrelated companies). Put it in `GROQ_API_KEY`.

---

## 3. What each free API does here

- **Groq (Llama 3.3 70B)** — writes the structured lesson. Free tier: ~30 req/min, ~1,000/day.
- **Groq vision (Llama 4 Scout)** — reads a photographed textbook page / problem.
- **Groq Whisper** — turns a spoken doubt (or a debate turn) into text.
- **Local .pptx generator (pptxgenjs)** — exports a real, *designed* PowerPoint of the deck:
  drawn flowcharts (boxes + arrows), a connected concept diagram, styled cards and a themed
  title slide. No paid API. Slide images come from **Pollinations** (`image.pollinations.ai`,
  free, no key); if an image can't be fetched the slide still renders with a drawn panel.
- **PeerJS** — free peer-to-peer video for the Group Debate rooms (public broker + Google STUN).
- **Tutor voice** — by default uses your **browser's built-in voices** (free, instant, supports
  `en-US`, `hi-IN`, `kn-IN` on most devices). For premium neural Hindi/Kannada voices, run
  `npm install msedge-tts` to enable the `/api/tts` endpoint (Microsoft Edge voices, also free).

### Multilingual & voice-first (India-specific)

- **Ask in any language, even mixed.** The language picker defaults to **"Auto — match me"**:
  the AI understands English, Hindi, Kannada, and romanized/code-mixed input (Hinglish like
  "ye reaction kaise hota hai", Kanglish, etc.) and writes the whole lesson back in the *same*
  language and script the student used. They can also force a language from the picker.
- **Voice-first flow.** Tap the mic, speak the doubt in any language → Whisper transcribes it
  (and detects the language), the lesson builds **automatically**, and the tutor **starts
  narrating out loud** without any typing. Speak → listen, end to end.
- On WhatsApp the bot defaults to Auto too, so a student texting in Hinglish or Kannada gets a
  reply in that same style (prefix `hindi:` / `kannada:` / `english:` to force one).

If Groq renames a model, just change `GROQ_TEXT_MODEL` / `GROQ_VISION_MODEL` /
`GROQ_WHISPER_MODEL` in `.env` — no code change. List current models:
```bash
curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
```

---

## 4. The talking teacher — be realistic

True per-answer **lip-sync video has no good free real-time API.** Your two honest paths:

- **Phase 1 (this app, free, works now):** loop your teacher video + play synced TTS audio
  with on-screen captions. Looks great, costs ₹0.
- **Phase 2 (later, needs a GPU):** generate a fresh lip-synced clip per answer using
  open-source **Wav2Lip** or **MuseTalk** on a Colab/cloud GPU, or a paid free-tier API
  (D-ID, Hedra, Sync). Add it as a background job that swaps the looping video for the
  generated clip once ready. Don't build this first.

Replace `public/uploads/teacher.mp4` with your own teacher loop.

---

## 5. Project map

```
server.js            Express server + all API routes (auth, doubt, stt, deck-file, tts, debate)
lib/groq.js          lesson generation + photo reading + Whisper + debate topic & judging
lib/deck.js          local designed .pptx generator (flowcharts, diagrams, images)
lib/presenton.js     legacy Presenton export (no longer used — kept for reference)
lib/tts.js           optional neural voice (edge-tts)
lib/store.js         JSON-file user + doubt store (swap for a DB later)
lib/whatsapp.js      WhatsApp Cloud API send/receive + lesson formatting
lib/wa-webhook.js    the webhook Meta calls (verify + inbound messages)
public/index.html    landing page (your design) — "Try it free" → login
public/login.html    login / signup
public/app.html      dashboard: sidebar + ask bar + deck + tutor + group debate
public/app.js        all dashboard logic
public/debate.js     Group Study live debate room (PeerJS video + turns + AI judge)
```

### Group Study — live debate rooms

Sidebar → **Group Study**. One student taps **Create a room** and shares the short code
(e.g. `TIGER-42`). Others **join with the code + their name & ID**, cameras on. Someone types a
topic or taps **AI topic** (Groq suggests a fresh, balanced motion). Debaters **Take the floor**
one at a time (their mic records only while they hold it), then **Pass**. On **End & Analyse**,
each person's speech is transcribed (Whisper) and the AI judge names the **strongest debater**
and gives every speaker **key points, positives and negatives** with a 0–100 score.

Video is peer-to-peer via PeerJS's free broker + Google STUN. On strict/corporate networks a
direct connection can fail (no TURN server) — for a demo, put everyone on the same Wi-Fi or add
a free TURN server later.

The frontend is plain HTML/CSS/JS (no build step) so it's easy to run and edit. Move to
React later if you want — the API stays the same.

---

## 6. WhatsApp bot (optional)

The bot reuses the **same** AI backend: a student texts a doubt (or sends a photo / voice
note) to your WhatsApp number and gets back a formatted mini-lesson + a tutor voice note.
WhatsApp is a chat, so there's no slide UI there — the lesson arrives as clean text plus
audio. Both the web app and the bot save to the same doubt library.

**Cost:** using the Cloud API is free. User-initiated chats are free for 24 hours, and the
first 1,000 service conversations each month are free — plenty for a student project.

### One-time setup (~30 min)

1. Go to **developers.facebook.com** → create an app → add the **WhatsApp** product.
2. In *WhatsApp → API setup* you get a free **test number**, a temporary **access token**,
   and a **Phone number ID**. Add your own phone as a test recipient.
3. Put these in `.env`:
   ```
   WA_TOKEN=<the access token>
   WA_PHONE_ID=<the phone number ID>
   WA_VERIFY_TOKEN=studenthub-verify   # any string you choose
   ```
4. Your server needs a **public HTTPS URL**. For local testing run
   [ngrok](https://ngrok.com): `ngrok http 3000` gives a URL like
   `https://abc123.ngrok-free.app`. For production, deploy to Render / Railway / Fly (free tiers).
5. In *WhatsApp → Configuration → Webhook*, set:
   - **Callback URL:** `https://YOUR_URL/webhook/whatsapp`
   - **Verify token:** the same string you put in `WA_VERIFY_TOKEN`
   - Click verify (Meta GETs your URL — the code answers the handshake automatically).
   - **Subscribe** to the `messages` field.
6. Message your test number from WhatsApp: `hi` → welcome, then ask anything.

### How students use it
- Type a question, send a **photo** of a problem, or a **voice note**.
- For another language, prefix the message: `hindi: प्रकाश संश्लेषण कैसे होता है?`
  or `kannada: ...`. Default is English.

### Notes
- The temporary token expires in ~24h. For production make a **System User** with a
  **permanent token** (Meta Business Settings → Users → System Users).
- The tutor voice note needs `npm install msedge-tts`. Without it, students still get the
  full text lesson.
- The bot is fully optional: leave the `WA_*` vars blank and the web app runs as before.

---

## 7. Going to production (checklist)

- Swap `lib/store.js` for a real database (SQLite is the easiest upgrade; Postgres for scale).
- Add rate-limiting + an email verification step.
- Cache generated lessons so the same doubt doesn't re-spend Groq quota.
- Move secrets to your host's env vars; never ship `.env`.
- Add HTTPS (deploy behind Render / Railway / Fly.io — all have free tiers).
