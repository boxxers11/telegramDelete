# Telegram Message Deleter

אפליקציה מקומית למחיקה בטוחה של ההודעות שלך בטלגרם עם תמיכה ב-5 חשבונות.

## 🌐 דמו אונליין

אתה יכול לראות את הממשק בכתובת: https://local-telegram-messa-cgvs.bolt.host

**חשוב**: הדמו האונליין מציג רק את הממשק. כדי להתחבר לטלגרם ולמחוק הודעות, חובה להוריד ולהריץ את האפליקציה מקומית.

## ⚠️ הסברים חשובים

- **אחריות משפטית**: אתה אחראי לוודא שאתה עומד בתנאי השימוש של טלגרם ובחוקים המקומיים
- **בטיחות מידע**: הכלי מוחק רק את ההודעות שלך ומדלג אוטומטית על קבוצות עם 10 חברים או פחות
- **פעולה מקומית**: הכל רץ על המחשב שלך - שום מידע לא נשלח לשרתים חיצוניים
- **גיבוי מומלץ**: כדאי לגבות הודעות חשובות לפני המחיקה

## 📥 הורדה והתקנה - צעד אחרי צעד

הדמו האונליין הוא רק לתצוגה. כדי להשתמש בפונקציונליות האמיתית, יש להוריד ולהריץ מקומית:

### שלב 1: הורדת הקבצים מ-GitHub

**אם יש לך Git מותקן:**
```bash
git clone [URL של הפרויקט]
cd telegram-message-deleter
```

**אם אין לך Git:**
1. **לחץ על הכפתור הירוק "Code"** בעמוד GitHub
2. **בחר "Download ZIP"**
3. **חלץ את הקבצים** לתיקייה במחשב שלך
4. **פתח טרמינל/Command Prompt** בתיקייה הזו

### שלב 1.5: התקנת תלויות (חובה!)

**במק/לינוקס - התקן Node.js:**
```bash
# אופציה 1: הורד מ-https://nodejs.org
# אופציה 2: עם Homebrew
brew install node
```

**בווינדוס:**
1. הורד Node.js מ-https://nodejs.org
2. התקן כרגיל
3. הפעל מחדש את Command Prompt

### שלב 2: קבלת נתוני API של טלגרם
1. **היכנס ל-** https://my.telegram.org
2. **התחבר עם מספר הטלפון שלך**
3. **לך ל-"API Development Tools"**
4. **צור אפליקציה חדשה** ושמור את:
   - **API ID** (מספר)
   - **API Hash** (מחרוזת ארוכה)

### שלב 3: הפעלת האפליקציה

**וודא שיש לך Python ו-Node.js מותקנים:**
```bash
python3 --version  # צריך להיות 3.10+
node --version     # צריך להיות 16+
npm --version      # צריך להיות 8+
```

**במק/לינוקס:**
```bash
chmod +x run.sh
./run.sh
```

**בווינדוס:**
```cmd
run.bat
```

**אם יש שגיאות:**
- `python: command not found` → השתמש ב-`python3` במקום `python`
- `npm: command not found` → התקן Node.js מ-https://nodejs.org
- `ECONNREFUSED 127.0.0.1:8000` → חכה 30 שניות ורענן את הדפדפן

### שלב 4: פתיחת האפליקציה

### שלב 5: הוספת חשבון
1. **לחץ על "Add Account"**
2. **מלא את הפרטים:**
   - **Label**: שם לחשבון (למשל "אישי")
   - **API ID**: המספר מהשלב 2
   - **API Hash**: המחרוזת מהשלב 2
   - **Phone**: מספר הטלפון שלך (עם +)
3. **לחץ "Add Account"**


## 🔧 Features

### Multi-Account Support
- **Up to 5 accounts**: Manage multiple Telegram accounts from one interface
- **Independent operations**: Scan or delete messages per account or across all accounts
- **Concurrent processing**: Process multiple accounts simultaneously with rate limiting
- **Account management**: Add, remove, and authenticate accounts through the web interface

### Safety Features
- **Dry-run by default**: Always test before deleting
- **Group size protection**: Automatically skips groups with ≤10 members
- **Your messages only**: Only deletes messages sent by your account
- **Rate limit handling**: Automatically handles Telegram's rate limits

### Filtering Options
- **Chat type**: Choose between groups only or include private chats
- **Chat names**: Filter by comma-separated chat name keywords
- **Date range**: Delete messages only within specific date ranges
- **Message limits**: Set maximum messages to delete per chat
- **Deletion type**: Choose to delete for everyone (revoke) or just for yourself

### Testing & Validation
- **Test mode**: Process only first 5 chats for quick validation
- **Detailed logging**: Real-time progress and error logs
- **Comprehensive results**: See exactly what was processed, skipped, and deleted

## 🛡️ Security Notes

- **Session Storage**: Your Telegram session is stored locally in `tg_ui_session.session`
- **Credentials**: API credentials are only used locally and never transmitted elsewhere
- **Privacy**: No analytics, tracking, or external connections except to Telegram's servers

## 📊 Understanding the Results

### Multi-Account Results
- **Account-level summaries**: See results grouped by account with individual statistics
- **Global summary**: Combined statistics across all processed accounts
- **Authentication status**: Clear indication of which accounts are connected and processed

### Chat Status Types
- **Processed**: Chat was scanned/processed according to your filters
- **Skipped**: Chat was skipped for safety (≤10 members) or filter reasons

### Log Messages
- `[HH:MM:SS]` - Timestamped operations
- Rate limit warnings show wait times
- Error messages provide specific failure reasons

## 🔍 Troubleshooting

### Authentication Issues
- **"Invalid API ID/Hash"**: Double-check credentials from https://my.telegram.org
- **"Not authenticated"**: Restart the app and re-enter credentials
- **2FA prompts**: Watch the terminal window for password prompts

### Operation Issues
- **FloodWaitError**: The app automatically waits - this is normal for large operations
- **Empty results**: Check your filters - you might have no messages in the specified criteria
- **Slow scanning**: Normal for accounts with many chats - use test mode for quick validation

### Performance Tips
- Use specific chat name filters to reduce scope
- Set reasonable date ranges to limit message iteration
- Use test mode to validate settings before full runs
- Set per-chat limits for very active groups

## 📝 File Structure

```
telegram-message-deleter/
├── app/
│   ├── __init__.py
│   ├── accounts.py           # Account management and JSON storage
│   ├── main.py              # FastAPI server
│   ├── telegram_delete.py   # Core deletion logic
│   ├── telegram_client_factory.py  # Client factory for accounts
│   ├── templates/
│   │   └── index.html       # Web interface
│   └── static/
│       └── style.css        # Custom styles
├── sessions/                # Directory for session files (created automatically)
├── accounts.json           # Account storage (created automatically)
├── requirements.txt         # Python dependencies
├── run.sh                  # Start script (Mac/Linux)
├── run.bat                 # Start script (Windows)
├── README.md               # This file
└── tg_ui_session.session   # Legacy single account session (if used)
```

## 🤝 Support

This is a self-contained local application. If you encounter issues:

1. Check the terminal/command prompt for detailed error messages
2. Verify your API credentials are correct
3. Ensure stable internet connection
4. Try test mode first to validate your setup

## ⚖️ Legal Notice

By using this software, you acknowledge that:
- You will only delete your own messages
- You will comply with Telegram's Terms of Service
- You will respect local laws regarding data deletion
- You understand the risks of automated message deletion