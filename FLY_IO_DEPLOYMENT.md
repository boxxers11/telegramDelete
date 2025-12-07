# ✈️ מדריך Deployment ל-Fly.io (מומלץ ביותר!)

Fly.io הוא השירות הכי מומלץ להפעלת האפליקציה שלך **תמיד מופעלת** עם דומיין חינמי.

## 🎯 למה Fly.io?

✅ **תמיד מופעל** - לא נכנס ל-sleep mode כמו Render  
✅ **דומיין חינמי** - מקבל דומיין אוטומטי: `your-app.fly.dev`  
✅ **Persistent Storage חינמי** - 3GB חינם  
✅ **מהיר מאוד** - Global CDN  
✅ **3 VMs חינם** - מספיק לאפליקציה קטנה  
✅ **SSL אוטומטי** - HTTPS מופעל אוטומטית  

---

## 📋 שלבים להפעלה

### 1. התקנת Fly CLI

**macOS:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

**Windows (PowerShell):**
```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

הוסף ל-PATH:
```bash
export FLYCTL_INSTALL="/home/$USER/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
```

### 2. הרשמה

```bash
fly auth signup
```

או אם כבר יש לך חשבון:
```bash
fly auth login
```

### 3. בניית Frontend

```bash
cd /Users/haimrep/telegramDelete
npm run build
```

### 4. יצירת אפליקציה

```bash
fly launch
```

במהלך ההפעלה:
- **App name:** בחר שם (או השאר ריק לאוטומטי)
- **Region:** בחר `iad` (Washington DC) או `fra` (Frankfurt) - קרוב יותר לישראל
- **Postgres:** לא (לא צריך)
- **Redis:** לא (לא צריך)

### 5. יצירת Volume לאחסון קבצים

```bash
fly volumes create telegram_data --size 1 --region iad
```

זה יוצר 1GB של אחסון קבוע לקבצי session ונתונים.

### 6. עדכון fly.toml

צור או עדכן את הקובץ `fly.toml`:

```toml
app = "your-app-name"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8001"
  PYTHONUNBUFFERED = "1"

[[services]]
  internal_port = 8001
  protocol = "tcp"
  processes = ["app"]

  [[services.ports]]
    handlers = ["http"]
    port = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
    protocol = "http"
    tls_skip_verify = false

[mounts]
  source = "telegram_data"
  destination = "/app/sessions"
```

### 7. הוספת Health Check Endpoint

ודא שיש לך endpoint `/health` ב-`app/main.py`:

```python
@app.get("/health")
async def health_check():
    return {"status": "ok"}
```

### 8. Deploy

```bash
fly deploy
```

זה יבנה את ה-Docker image ויעלה את האפליקציה.

### 9. קבלת דומיין

```bash
fly status
```

או:

```bash
fly open
```

הדומיין יהיה: `https://your-app-name.fly.dev`

---

## 🔧 הגדרות נוספות

### הגדרת Environment Variables (אם צריך)

```bash
fly secrets set CLOUD_STORAGE_ENDPOINT=https://your-storage.com
fly secrets set CLOUD_STORAGE_API_KEY=your-api-key
```

### צפייה בלוגים

```bash
fly logs
```

### צפייה בסטטוס

```bash
fly status
```

### פתיחת האפליקציה בדפדפן

```bash
fly open
```

### הגדלת Volume (אם צריך יותר מקום)

```bash
fly volumes extend telegram_data --size 2
```

---

## 🔄 עדכונים

כל פעם שאתה רוצה לעדכן את האפליקציה:

```bash
# 1. עדכן את הקוד
git pull  # או ערוך קבצים

# 2. בנה frontend
npm run build

# 3. Deploy
fly deploy
```

---

## 📊 ניהול

### צפייה בכל ה-Apps

```bash
fly apps list
```

### צפייה ב-Volumes

```bash
fly volumes list
```

### מחיקת App (אם צריך)

```bash
fly apps destroy your-app-name
```

---

## ⚠️ הערות חשובות

1. **Session Files**: הקבצים ב-`/app/sessions` נשמרים ב-volume `telegram_data`
2. **Accounts.json**: נשמר גם ב-volume
3. **Backups**: הקבצים ב-`/app/cloud_backups` נשמרים ב-volume
4. **Port**: האפליקציה רצה על פורט 8001 פנימית, Fly.io מנתב אוטומטית ל-80/443

---

## 🆚 השוואה לשירותים אחרים

| תכונה | Fly.io | Railway | Render |
|------|--------|---------|--------|
| תמיד מופעל | ✅ | ✅ | ❌ (sleep mode) |
| דומיין חינמי | ✅ | ✅ | ✅ |
| Persistent Storage | ✅ (3GB) | ✅ ($5 credit) | ⚠️ (בתשלום) |
| מהירות | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| קלות שימוש | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 🎯 Quick Start (סיכום)

```bash
# 1. התקן CLI
curl -L https://fly.io/install.sh | sh

# 2. התחבר
fly auth signup

# 3. בנה frontend
cd /Users/haimrep/telegramDelete
npm run build

# 4. צור app
fly launch

# 5. צור volume
fly volumes create telegram_data --size 1 --region iad

# 6. Deploy
fly deploy

# 7. פתח בדפדפן
fly open
```

---

## 🆘 פתרון בעיות

### האפליקציה לא עולה

```bash
fly logs
```

### Volume לא מחובר

```bash
fly volumes list
fly volumes show telegram_data
```

### Port לא נכון

ודא שב-`fly.toml` יש:
```toml
internal_port = 8001
```

### Health check נכשל

ודא שיש `/health` endpoint ב-`app/main.py`

---

## 📚 משאבים נוספים

- [תיעוד Fly.io](https://fly.io/docs/)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Fly.io Regions](https://fly.io/docs/reference/regions/)

---

**🎉 מזל טוב! האפליקציה שלך עכשיו רצה תמיד עם דומיין חינמי!**

