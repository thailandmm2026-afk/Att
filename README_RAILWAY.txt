RAILWAY DEPLOYMENT

Required files:
- bot.ts
- package.json
- tsconfig.json
- railway.json
- .gitignore

Environment Variables:
- BOT_TOKEN = Telegram BotFather token (required)
- ADMIN_USER_ID = your Telegram numeric user ID (if the bot uses admin features)
- ADMIN_PASSWORD = admin panel password (if used)
- DB_PATH = optional persistent database directory

Railway:
1. Push these files to GitHub.
2. Railway -> New Project -> Deploy from GitHub Repo.
3. Add Variables in Railway.
4. Set BOT_TOKEN.
5. Deploy. The start command is: npm start

For persistent bot_db.json:
- Create a Railway Volume.
- Mount it, then set DB_PATH to the volume mount path.
- The bot also recognizes RAILWAY_VOLUME_MOUNT_PATH automatically.
