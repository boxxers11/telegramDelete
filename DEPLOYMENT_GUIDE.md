# ☁️ מדריך Deployment - Telegram Message Deleter

מדריך זה מסביר איך להעלות את האפליקציה ל-Cloud כך שהיא תרוץ תמיד.

## ⚠️ הערות חשובות לפני Deployment

1. **אבטחה**: האפליקציה משתמשת ב-Telegram API credentials. ודא שאתה לא חושף אותם ב-public repositories.
2. **Session Files**: קבצי ה-session של טלגרם צריכים להישמר בין הפעלות. השתמש ב-volumes או persistent storage.
3. **Rate Limits**: טלגרם מגביל פעולות. האפליקציה מטפלת בזה אוטומטית, אבל זה יכול לקחת זמן.

---

## 🐳 אופציה 1: Docker (מקומי או VPS)

### התקנת Docker

**macOS:**
```bash
brew install docker docker-compose
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install docker.io docker-compose
```

### בניית והפעלת עם Docker

```bash
cd /Users/haimrep/telegramDelete

# בניית ה-frontend
npm run build

# בניית ה-Docker image
docker build -t telegram-deleter .

# הפעלה עם docker-compose
docker-compose up -d

# צפייה בלוגים
docker-compose logs -f
```

### גישה לאפליקציה
- פתח בדפדפן: `http://localhost:8001`

### עצירה
```bash
docker-compose down
```

---

## 🚂 אופציה 2: Railway.app (חינמי - מומלץ!)

Railway מציע **$5 חינם** כל חודש, מספיק לאפליקציה קטנה.

### שלבים:

1. **הירשם ל-Railway:**
   - לך ל-https://railway.app
   - הירשם עם GitHub

2. **העלה את הפרויקט:**
   ```bash
   # התקן Railway CLI
   npm i -g @railway/cli
   
   # התחבר
   railway login
   
   # בתיקיית הפרויקט
   cd /Users/haimrep/telegramDelete
   
   # צור פרויקט חדש
   railway init
   
   # העלה את הקוד
   railway up
   ```

3. **הגדר משתני סביבה:**
   - ב-Railway Dashboard → Variables
   - אין צורך במשתנים מיוחדים (הכל נשמר ב-volumes)

4. **הגדר Volumes (חשוב!):**
   - ב-Railway Dashboard → Volumes
   - צור volumes עבור:
     - `/app/sessions` - קבצי session של טלגרם
     - `/app/cloud_backups` - גיבויים
     - `/app/accounts.json` - חשבונות

5. **הגדר Port:**
   - ב-Railway Dashboard → Settings
   - Port: `8001`

### יתרונות:
- ✅ חינמי עד $5/חודש
- ✅ Auto-deploy מ-GitHub
- ✅ SSL אוטומטי
- ✅ Persistent storage

---

## 🎨 אופציה 3: Render.com (חינמי)

Render מציע **tier חינמי** עם הגבלות.

### שלבים:

1. **הירשם ל-Render:**
   - לך ל-https://render.com
   - הירשם עם GitHub

2. **צור Web Service:**
   - New → Web Service
   - בחר את ה-repository שלך
   - הגדרות:
     - **Build Command:** `npm run build && pip install -r requirements.txt`
     - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
     - **Environment:** Python 3
     - **Port:** `8001`

3. **הגדר Environment Variables:**
   - אין צורך במשתנים מיוחדים

4. **הגדר Persistent Disk (חשוב!):**
   - Settings → Persistent Disk
   - צור disk עבור:
     - `/app/sessions`
     - `/app/cloud_backups`

### יתרונות:
- ✅ חינמי (עם הגבלות)
- ✅ Auto-deploy מ-GitHub
- ✅ SSL אוטומטי

### חסרונות:
- ⚠️ ה-sleep אחרי 15 דקות של חוסר פעילות (tier חינמי)
- ⚠️ Persistent disk עולה כסף

---

## ✈️ אופציה 4: Fly.io (חינמי)

Fly.io מציע **3 VMs חינם** עם 256MB RAM כל אחד.

### שלבים:

1. **התקן Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **הירשם:**
   ```bash
   fly auth signup
   ```

3. **צור אפליקציה:**
   ```bash
   cd /Users/haimrep/telegramDelete
   fly launch
   ```

4. **צור `fly.toml`:**
   ```toml
   app = "telegram-deleter"
   primary_region = "iad"

   [build]
     dockerfile = "Dockerfile"

   [[services]]
     internal_port = 8001
     protocol = "tcp"

     [[services.ports]]
       handlers = ["http"]
       port = 80
       force_https = true

     [[services.ports]]
       handlers = ["tls", "http"]
       port = 443

   [mounts]
     source = "telegram_data"
     destination = "/app/sessions"
   ```

5. **צור volume:**
   ```bash
   fly volumes create telegram_data --size 1
   ```

6. **Deploy:**
   ```bash
   fly deploy
   ```

### יתרונות:
- ✅ חינמי (3 VMs)
- ✅ מהיר מאוד
- ✅ Global CDN

---

## ▲ אופציה 5: Vercel (חינמי - רק Frontend)

Vercel מושלם ל-Frontend, אבל לא יכול להריץ את ה-Backend Python.

### פתרון: Frontend ב-Vercel + Backend ב-Railway/Render

1. **Deploy Frontend ל-Vercel:**
   ```bash
   npm i -g vercel
   cd /Users/haimrep/telegramDelete
   vercel
   ```

2. **עדכן את `vite.config.ts`:**
   ```typescript
   export default defineConfig({
     plugins: [react()],
     server: {
       port: 5173,
       proxy: {
         '/api': {
           target: 'https://your-backend-url.railway.app', // URL של ה-Backend
           changeOrigin: true,
           rewrite: (path) => path.replace(/^\/api/, '')
         }
       }
     }
   });
   ```

3. **עדכן את `src/config/api.ts`:**
   ```typescript
   export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://your-backend-url.railway.app';
   ```

---

## ☁️ אופציה 6: Cloudflare Workers/Pages (חינמי)

Cloudflare מציע Workers חינמיים, אבל Python לא נתמך ישירות.

### פתרון: השתמש ב-Docker + Cloudflare Tunnel

1. **הרץ את ה-Docker container מקומית או ב-VPS**

2. **התקן Cloudflare Tunnel:**
   ```bash
   # הורד מ-https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
   cloudflared tunnel create telegram-deleter
   cloudflared tunnel route dns telegram-deleter your-domain.com
   cloudflared tunnel run telegram-deleter
   ```

---

## 📊 השוואת שירותים

| שירות | חינמי | Persistent Storage | Auto-Deploy | SSL | מומלץ |
|-------|-------|-------------------|-------------|-----|--------|
| Railway | ✅ $5/חודש | ✅ | ✅ | ✅ | ⭐⭐⭐⭐⭐ |
| Render | ✅ (מוגבל) | ⚠️ בתשלום | ✅ | ✅ | ⭐⭐⭐⭐ |
| Fly.io | ✅ (3 VMs) | ✅ | ✅ | ✅ | ⭐⭐⭐⭐ |
| Vercel | ✅ | ❌ | ✅ | ✅ | ⭐⭐⭐ (רק Frontend) |
| Docker (VPS) | ✅ | ✅ | ⚠️ ידני | ⚠️ ידני | ⭐⭐⭐ |

---

## 🎯 המלצה: Railway.app

**למה Railway?**
1. ✅ $5 חינם כל חודש - מספיק לאפליקציה קטנה
2. ✅ Persistent storage חינמי
3. ✅ Auto-deploy מ-GitHub
4. ✅ SSL אוטומטי
5. ✅ קל להגדרה
6. ✅ תמיכה טובה

### Quick Start עם Railway:

```bash
# 1. התקן CLI
npm i -g @railway/cli

# 2. התחבר
railway login

# 3. צור פרויקט
cd /Users/haimrep/telegramDelete
railway init

# 4. העלה
railway up

# 5. קבל URL
railway domain
```

---

## 🔧 הגדרת Environment Variables (אם צריך)

אם אתה משתמש ב-Cloud Storage, הוסף:

```bash
CLOUD_STORAGE_ENDPOINT=https://your-storage.com
CLOUD_STORAGE_API_KEY=your-api-key
CLOUD_BACKUP_RETENTION_DAYS=7
```

---

## 📝 הערות חשובות

1. **Session Files**: הקבצים ב-`sessions/` חייבים להישמר! השתמש ב-volumes או persistent storage.

2. **Accounts.json**: הקובץ `accounts.json` צריך להישמר גם כן.

3. **Backups**: הקבצים ב-`cloud_backups/` נשמרים אוטומטית אם הגדרת Cloud Storage.

4. **Port**: ודא שה-Port מוגדר נכון (8001).

5. **Build**: לפני deployment, ודא שאתה מריץ `npm run build` כדי לבנות את ה-Frontend.

---

## 🆘 פתרון בעיות

### האפליקציה לא נגישה:
- בדוק שה-Port מוגדר נכון
- בדוק שה-URL נכון
- בדוק את הלוגים: `railway logs` או `docker-compose logs`

### Session files נעלמים:
- ודא ש-volumes מוגדרים נכון
- בדוק שה-paths נכונים

### Build נכשל:
- ודא ש-`npm run build` עובד מקומית
- בדוק את הלוגים של ה-build

---

## 📚 משאבים נוספים

- [Railway Docs](https://docs.railway.app)
- [Render Docs](https://render.com/docs)
- [Fly.io Docs](https://fly.io/docs)
- [Docker Docs](https://docs.docker.com)

