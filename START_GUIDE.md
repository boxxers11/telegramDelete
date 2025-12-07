# 🚀 מדריך הפעלה - Telegram Message Deleter

## חלק 1: הפעלה מקומית בטרמינלים

### אופציה A: הפעלה מהירה (מומלץ למתחילים)

**טרמינל אחד:**
```bash
cd /Users/haimrep/telegramDelete
./run.sh
```

זה מפעיל את שני השרתים יחד. לחץ `Ctrl+C` כדי לעצור.

---

### אופציה B: הפעלה בטרמינלים נפרדים (מומלץ למתקדמים)

**טרמינל 1 - Backend (Python FastAPI):**
```bash
cd /Users/haimrep/telegramDelete

# הפעלת סביבה וירטואלית
source venv/bin/activate

# בדיקה אם הפורט תפוס (אופציונלי)
lsof -iTCP:8001 -sTCP:LISTEN

# הפעלת השרת
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

**טרמינל 2 - Frontend (React/Vite):**
```bash
cd /Users/haimrep/telegramDelete

# בדיקה אם הפורט תפוס (אופציונלי)
lsof -iTCP:5173 -sTCP:LISTEN

# הפעלת השרת
npm run dev
```

**טרמינל 3 - תחזוקה (אופציונלי):**
```bash
cd /Users/haimrep/telegramDelete

# צפייה בלוגים
tail -f logs/backend.log
tail -f logs/frontend.log

# בדיקת סטטוס השרתים
curl http://127.0.0.1:8001/accounts

# עצירת שרתים (אם צריך)
pkill -f "uvicorn app.main"
pkill -f "npm run dev"
```

---

### אופציה C: הפעלה ברקע (ממשיך לרוץ גם אחרי סגירת הטרמינל)

**הפעלה:**
```bash
cd /Users/haimrep/telegramDelete
chmod +x start-background.sh
./start-background.sh
```

**עצירה:**
```bash
./start-background.sh stop
```

**צפייה בלוגים:**
```bash
tail -f logs/backend.log
tail -f logs/frontend.log
```

---

## 🌐 גישה לאפליקציה

לאחר הפעלת שני השרתים:
- **Frontend**: פתח בדפדפן: `http://localhost:5173`
- **Backend API**: `http://127.0.0.1:8001`

---

## ⚠️ פתרון בעיות נפוצות

### שגיאה: "Port already in use"
```bash
# מצא את התהליך שתפוס את הפורט
lsof -iTCP:8001 -sTCP:LISTEN  # עבור Backend
lsof -iTCP:5173 -sTCP:LISTEN  # עבור Frontend

# עצור את התהליך (החלף <PID> במספר שהתקבל)
kill <PID>
```

### שגיאה: "venv/bin/activate: No such file"
```bash
# צור סביבה וירטואלית
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### שגיאה: "npm: command not found"
```bash
# התקן Node.js
brew install node  # macOS
# או הורד מ-https://nodejs.org
```

---

## חלק 2: Deployment ל-Cloud (המשך למטה)

ראה את הקובץ `DEPLOYMENT_GUIDE.md` לפרטים מלאים על:
- Docker deployment
- Railway.app (חינמי)
- Render.com (חינמי)
- Fly.io (חינמי)
- Vercel (חינמי - רק Frontend)
- Cloudflare Workers/Pages (חינמי)

