# הגדרת GitHub Token לגיבוי ענן

## למה צריך GitHub Token?

GitHub Gists מספק אחסון חינמי לאחסון גיבויים של האפליקציה. זה מאפשר:
- גיבוי אוטומטי של כל הנתונים (קבוצות, משתמשים, סריקות)
- שחזור נתונים במקרה של בעיה
- סנכרון בין מחשבים שונים

## איך ליצור GitHub Token?

1. **כנס ל-GitHub:**
   - לך ל: https://github.com/settings/tokens
   - או: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)

2. **צור Token חדש:**
   - לחץ על "Generate new token" → "Generate new token (classic)"
   - תן שם ל-token (למשל: "Telegram Delete Backup")
   - בחר את ה-scope: **רק `gist`** ✅
   - לחץ על "Generate token"

3. **העתק את ה-Token:**
   - ⚠️ **חשוב:** GitHub מציג את ה-token רק פעם אחת!
   - העתק אותו מיד

## איפה לשים את ה-Token?

יש 3 דרכים להגדיר את ה-token:

### אופציה 1: Environment Variable (מומלץ)

**ב-Mac/Linux:**
```bash
# הוסף לשורת הפקודה לפני הפעלת השרת:
export GITHUB_TOKEN="your_token_here"

# או הוסף לקובץ ~/.zshrc או ~/.bashrc:
echo 'export GITHUB_TOKEN="your_token_here"' >> ~/.zshrc
source ~/.zshrc
```

**ב-Windows (PowerShell):**
```powersh
ell
$env:GITHUB_TOKEN="your_token_here"
```

### אופציה 2: קובץ .env

צור קובץ `.env` בתיקיית הפרויקט:
```bash
# .env
GITHUB_TOKEN=your_token_here
```

⚠️ **חשוב:** הוסף את `.env` ל-`.gitignore` כדי לא לחשוף את ה-token!

### אופציה 3: export לפני הפעלה

בטרמינל לפני הפעלת השרת:
```bash
export GITHUB_TOKEN="your_token_here"
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

## איך לוודא שזה עובד?

1. הפעל את השרת
2. בדוק את הלוגים - צריך להופיע:
   ```
   INFO: Using GitHub Gists for cloud storage for account acc_1
   ```
3. אם זה לא עובד, יופיע:
   ```
   WARNING: GitHub token not configured. Using local storage fallback.
   ```

## מה קורה בלי Token?

האפליקציה תעבוד מצוין גם בלי token - היא פשוט תשתמש ב-local storage בלבד (קבצים בתיקיית `sessions/` ו-`cloud_backups/`).

## אבטחה

- ⚠️ **אל תשתף את ה-token שלך!**
- ⚠️ **אל תעלה את ה-token ל-GitHub!**
- ✅ הוסף את `.env` ל-`.gitignore`
- ✅ הוסף את `sessions/` ל-`.gitignore`
- ✅ אם חשודtoken נחשף, מחק אותו מ-GitHub וצור חדש

## שימוש ב-GitHub Gists

- כל חשבון יכול ליצור **ללא הגבלה** של Gists פרטיים
- כל Gist יכול להכיל עד **1MB** (מספיק בהחלט לנתוני האפליקציה)
- הנתונים נשמרים אוטומטית כל פעם שיש עדכון
- אפשר לראות את ה-Gists ב: https://gist.github.com/

