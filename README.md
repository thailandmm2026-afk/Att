# ATOM + MYTEL (MyID) Combined Telegram Bot

`bot.ts` (ATOM TohToh / ရွှေလယ်တော / City Run) + `Myid.py` (MYTEL MyID / OU Game) ကို ပေါင်းစပ်ထားသည်။

## Features

### ATOM
- OTP Login
- လက်ကျန်ငွေ / ပွိုင့်
- TohToh ကူပွန် & ဆော့ရန် & Live ဝယ်
- ရွှေလယ်တော ကူပွန် & ဆော့ရန် & Live ဝယ်
- City Run
- Daily Point Claim

### MYTEL (MyID)
- 🔐 MYTEL Login (OTP)
- 🎮 OU Game ဆော့ရန် (rounds ရွေးပြီး auto play)
- 🎁 MYTEL Daily Reward
- 👤 Profile / 🎫 Turns
- 🔄 Logout

### Force Channel Join (အမှန်တကယ် အလုပ်လုပ်သည်)
- `channels.json` ထဲက channel များကို join မလုပ်ရင် bot မသုံးနိုင်
- Admin က `/addchannel @xxx` / `/removechannel @xxx` နဲ့ စီမံ
- **Bot ကို channel ထဲမှာ Admin အဖြစ် ထည့်ပေးရမယ်** (getChatMember အလုပ်လုပ်ဖို့)

## Setup

```bash
cp .env.example .env
# .env ထဲ TELEGRAM_BOT_TOKEN နဲ့ ADMIN_USER_ID ထည့်

npm install
npm start
# or
npx tsx bot.ts
```

## Admin commands
- `/admin` – dashboard
- `/addchannel @channel` – force-join channel ထည့်
- `/removechannel @channel` – ဖယ်
- `/find @user` / `/find userid`
- `/broadcast message`

## Notes
- ATOM session နဲ့ MYTEL session က သီးခြား (နှစ်ခုလုံး login လုပ်ထားလို့ရ)
- OU Game play delay က original Myid.py ထက် တိုအောင် လုပ်ထား (UX အတွက် 8–20s)
- Store / Leaderboard အပြည့်အစုံ မပါသေး (လိုရင် ထပ်ထည့်ပေးနိုင်)
