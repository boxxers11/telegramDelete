# Telegram Message Deleter

A local web application for safely deleting your own Telegram messages across multiple groups and chats with **multi-account support** (up to 5 accounts).

## 🌐 Online Demo

You can view the interface demo at: https://local-telegram-messa-cgvs.bolt.host

**Note**: The online demo only shows the user interface. To actually connect to Telegram and manage messages, you must download and run the application locally as described below.

## ⚠️ Important Disclaimers

- **Legal Compliance**: You are responsible for ensuring compliance with Telegram's Terms of Service and all applicable local laws
- **Data Safety**: This tool only deletes YOUR OWN messages and automatically skips groups with 10 or fewer members
- **Local Operation**: Everything runs locally on your machine - no data is sent to external servers
- **Backup Recommended**: Consider backing up important messages before deletion

## 📥 Download and Setup

The online demo is for preview only. To use the actual Telegram functionality:

1. **Download the project files** (all Python server files and dependencies)
2. **Follow the setup instructions below** to run locally
3. **The local version will have full Telegram integration**

## 🚀 Quick Start

### Prerequisites
- Python 3.10 or higher
- Telegram API credentials (get from https://my.telegram.org)

### Setup Steps

1. **Get Telegram API Credentials**
   - Go to https://my.telegram.org
   - Log in with your phone number
   - Go to "API Development Tools"
   - Create an application and note your `API ID` and `API Hash`

2. **Install and Run**
   
   **On Mac/Linux:**
   ```bash
   ./run.sh
   ```
   
   **On Windows:**
   ```cmd
   run.bat
   ```

3. **First Time Setup**
   - The Python server will start at http://127.0.0.1:8000
   - Open the React UI at the URL shown in the terminal (usually http://localhost:5173)
   - Use the web interface to add accounts and manage operations
   - All login codes and 2FA passwords are entered through the web interface

4. **Use the Application**
   - **Add accounts**: Use the Account Management section to add up to 5 Telegram accounts
   - **Authenticate**: Connect each account by entering verification codes from Telegram
   - **Configure preferences**: Set your deletion filters and options
   - **Per-account operations**: Use "Scan" or "Delete" buttons for individual accounts
   - **Global operations**: Use "Scan All Accounts" or "Delete All Accounts" for bulk operations

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