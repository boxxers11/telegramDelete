# 🚀 התחלה מהירה - Telegram Message Deleter

## חלק 1: הפעלה מקומית

### אופציה מהירה (מומלץ):
```bash
cd /Users/haimrep/telegramDelete
./run.sh
```

פתח בדפדפן: `http://localhost:5173`

---

### אופציה עם טרמינלים נפרדים:

**טרמינל 1 - Backend:**
```bash
cd /Users/haimrep/telegramDelete
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

**טרמינל 2 - Frontend:**
```bash
cd /Users/haimrep/telegramDelete
npm run dev
```

---

### אופציה ברקע (ממשיך לרוץ אחרי סגירת הטרמינל):
```bash
cd /Users/haimrep/telegramDelete
./start-background.sh
```

עצירה:
```bash
./start-background.sh stop
```

---

## חלק 2: Deployment ל-Cloud (תמיד מופעל)

### 🎯 המלצה: Railway.app (חינמי!)

```bash
# התקן Railway CLI
npm i -g @railway/cli

# התחבר
railway login

# בתיקיית הפרויקט
cd /Users/haimrep/telegramDelete

# צור פרויקט והעלה
railway init
railway up

# קבל URL
railway domain
```

**יתרונות:**
- ✅ $5 חינם כל חודש
- ✅ Persistent storage חינמי
- ✅ Auto-deploy מ-GitHub
- ✅ SSL אוטומטי

---

### אופציות נוספות:

1. **Render.com** - חינמי עם הגבלות
2. **Fly.io** - 3 VMs חינם
3. **Docker + VPS** - שליטה מלאה

ראה `DEPLOYMENT_GUIDE.md` לפרטים מלאים.

---

## 📚 קבצים חשובים:

- `START_GUIDE.md` - מדריך מפורט להפעלה מקומית
- `DEPLOYMENT_GUIDE.md` - מדריך מפורט ל-Deployment
- `README.md` - תיעוד מלא של האפליקציה

---

## ⚠️ פתרון בעיות:

### Port תפוס:
```bash
lsof -iTCP:8001 -sTCP:LISTEN  # Backend
lsof -iTCP:5173 -sTCP:LISTEN  # Frontend
kill <PID>
```

### אין venv:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### אין node_modules:
```bash
npm install
```

