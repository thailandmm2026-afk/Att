import fsSync from 'fs';
import pathSync from 'path';
import dotenv from 'dotenv';

// .env ကို အရင် load လုပ် (process.env မဖတ်ခင်)
dotenv.config({ path: pathSync.join(process.cwd(), '.env') });
dotenv.config(); // also try default .env discovery


const logStream = fsSync.createWriteStream(pathSync.join(process.cwd(), 'bot_debug.log'), { flags: 'a' });
const origLog = console.log;
const origErr = console.error;
console.log = function(...args) {
  origLog(...args);
  logStream.write('[LOG] ' + args.join(' ') + '\n');
};
console.error = function(...args) {
  origErr(...args);
  logStream.write('[ERR] ' + args.join(' ') + '\n');
};

import { Telegraf, Scenes, session, Markup } from 'telegraf';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import express from 'express';
import cors from 'cors';
import { URL } from 'url';

// ==========================================
// MYTEL / MyID Service (inlined – one file)
// ==========================================
const GAME_BASE_URL = 'https://pubapi-mygov2.mtgmm.co/v1/engine';
const MYID_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 15; 2312DRAABC)',
  'Accept': 'application/json, text/plain, */*',
};

const myidHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

interface MyIdSession {
  phone: string;
  access_token: string;
  full_name: string;
  avatar: string;
  subId?: string;
}

class MyIdService {
  static async sendOtp(phone: string): Promise<boolean> {
    const clean = phone.replace(/\D/g, '');
    const url = `https://apis.mytel.com.mm/myid/authen/v1.0/login/method/otp/get-otp?phoneNumber=${clean}`;
    try {
      const res = await axios.get(url, {
        headers: MYID_HEADERS,
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  static async verifyOtp(phone: string, otp: string): Promise<MyIdSession | null> {
    const clean = phone.replace(/\D/g, '');
    const url = 'https://apis.mytel.com.mm/myid/authen/v1.0/login/method/otp/validate-otp';
    const payload = {
      phoneNumber: clean,
      password: otp,
      appVersion: '1.0.93',
      buildVersionApp: '217',
      deviceId: '0',
      imei: '0',
      os: 'MYID PRO PLUS',
      osAp: 'IOS',
      version: '1.5',
    };
    try {
      const res = await axios.post(url, payload, {
        headers: { ...MYID_HEADERS, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.data?.errorCode === 200 && res.data?.result) {
        const result = res.data.result;
        return {
          phone: clean,
          access_token: result.access_token,
          full_name: result.full_name || '',
          avatar: result.avatar || 'https://s3.mytel.com.mm/myid-avatar/avatar/default.jpg',
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  static async getGameToken(session: MyIdSession): Promise<string | null> {
    const url = `${GAME_BASE_URL}/web/bootstrap.html`;
    const params = {
      uuid: 'e1106c2c7d8b20092b80a3cae45400e5',
      mcuid: '3a3d046c57074e24747dbc8a7a8a03a5',
      mcapp: 'myid',
    };
    const headers: any = {
      'access-token': session.access_token || '',
      'phone-number': session.phone || '',
      lang: 'en',
      avatar: session.avatar,
      username: session.full_name || '',
      'x-requested-with': 'com.myentertainment.oneid',
      ...MYID_HEADERS,
    };
    try {
      const res = await axios.get(url, {
        headers,
        params,
        httpsAgent: myidHttpsAgent,
        maxRedirects: 0,
        timeout: 15000,
        validateStatus: (s) => s === 302 || s < 400,
      });
      if (res.status === 302 && res.headers.location) {
        const loc = new URL(res.headers.location, GAME_BASE_URL);
        return loc.searchParams.get('token');
      }
      // sometimes token is in body or other
      return null;
    } catch (e: any) {
      // axios throws on 302 with maxRedirects 0 in some versions
      if (e.response?.status === 302 && e.response.headers?.location) {
        const loc = new URL(e.response.headers.location, GAME_BASE_URL);
        return loc.searchParams.get('token');
      }
      return null;
    }
  }

  static async claimDaily(gameToken: string): Promise<string> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/user/daily-reward`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200) {
        return `✅ Daily Reward Claimed!\n🎁 ${res.data?.message || 'Success!'}`;
      }
      return 'ℹ️ Daily Reward: Already claimed for today (သို့မဟုတ် မရနိုင်သေးပါ).';
    } catch {
      return 'ℹ️ Daily Reward: Already claimed for today.';
    }
  }

  static async getProfile(gameToken: string): Promise<string | null> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/user/profile`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status !== 200) return null;
      const data = res.data?.data || {};
      const stats = data.player_stats || {};
      const wallet = data.wallet || {};

      let text =
        `╔══════════════════════════════════╗\n` +
        `║        👤 PLAYER PROFILE         ║\n` +
        `╠══════════════════════════════════╣\n` +
        `║ 🎮 Name  : ${String(data.display_name || 'N/A').slice(0, 20)}\n` +
        `║ 🆔 ID    : ${String(data.user_id || 'N/A').slice(0, 15)}\n` +
        `║ 📱 Phone : ${data.username || 'N/A'}\n` +
        `╠══════════════════════════════════╣\n` +
        `║         📊 PLAYER STATS          ║\n` +
        `║ 🏆 Rank     : ${stats.current_rank || 'N/A'}\n` +
        `║ 🍈 Total 🍈 : ${stats.total_jackfruits || 0}\n` +
        `║ 🎮 Sessions : ${stats.total_sessions || 0}\n` +
        `╠══════════════════════════════════╣\n` +
        `║           👛 WALLET              ║\n`;

      const emojiMap: Record<string, string> = {
        HAMMER: '🔨', TURN_FREE: '🎫', TURN_PAID: '🎟️',
        DIAMOND: '💎', JACKFRUIT: '🍈', MIX: '🌀',
      };

      for (const [key, value] of Object.entries(wallet)) {
        const balance = (value as any)?.balance ?? 0;
        const emoji = emojiMap[key] || '💰';
        text += `║ ${emoji} ${key.padEnd(10)} : ${balance}\n`;
      }
      text += `╚══════════════════════════════════╝`;
      return text;
    } catch {
      return null;
    }
  }

  static async getTurns(gameToken: string): Promise<{ free: number; paid: number; total: number }> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/user/profile`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status !== 200) return { free: 0, paid: 0, total: 0 };
      const wallet = res.data?.data?.wallet || {};
      const free = wallet.TURN_FREE?.balance ?? 0;
      const paid = wallet.TURN_PAID?.balance ?? 0;
      return { free, paid, total: free + paid };
    } catch {
      return { free: 0, paid: 0, total: 0 };
    }
  }

  static async startGame(gameToken: string): Promise<boolean> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/start`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  static async claimSlot(gameToken: string, slotIndex: number): Promise<boolean> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/reward?slot_index=${slotIndex}`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  static async stopGame(gameToken: string): Promise<any> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/stop`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200) return res.data;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Play one full round (slots 5-9).
   * longDelay=true → original Python timing 60-300s per slot.
   * longDelay=false → practical 8-20s (default for bot UX).
   */
  static async playRound(
    gameToken: string,
    roundNum: number,
    progressCb?: (msg: string) => Promise<void>,
    longDelay = false
  ): Promise<{ rewards: string[]; total: number }> {
    const notify = async (m: string) => {
      if (progressCb) await progressCb(m).catch(() => {});
    };

    await notify(`🎮 Round ${roundNum} - Starting...`);
    const started = await this.startGame(gameToken);
    if (!started) {
      await notify('❌ Failed to start game');
      return { rewards: [], total: 0 };
    }

    await notify('✅ Game started! Claiming slots 5→9...');
    for (let slot = 5; slot <= 9; slot++) {
      await notify(`🎰 Claiming slot ${slot}/9...`);
      await this.claimSlot(gameToken, slot);
      if (slot < 9) {
        const delay = longDelay
          ? 60_000 + Math.floor(Math.random() * 240_000) // 60-300s (Python original)
          : 8_000 + Math.floor(Math.random() * 12_000);  // 8-20s practical
        await notify(`⏰ Waiting ${Math.round(delay / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    await notify('🛑 Stopping game...');
    const result = await this.stopGame(gameToken);
    const rewards: string[] = [];
    let total = 0;
    if (result?.data && Array.isArray(result.data)) {
      for (const reward of result.data) {
        const name = reward.name || 'Unknown';
        const value = reward.value || 0;
        rewards.push(`🍈 ${name}: +${value}`);
        total += value;
      }
    }
    return { rewards, total };
  }

  // ---------- Reward History (from Python bot) ----------
  static async getRewardHistory(gameToken: string, nextCursor?: string, limit = 10): Promise<any> {
    try {
      const params: any = { limit };
      if (nextCursor) params.next = nextCursor;
      const res = await axios.get(`${GAME_BASE_URL}/game/reward/history`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        params,
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data?.code === '0') {
        return res.data.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------- Store (from Python bot) ----------
  static async getCategories(gameToken: string): Promise<any[]> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/store/categories`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data?.code === '0') {
        const cats = res.data.data || [];
        cats.sort((a: any, b: any) => (a.display_order ?? 999) - (b.display_order ?? 999));
        return cats;
      }
      return [];
    } catch {
      return [];
    }
  }

  static async getCategoryItems(gameToken: string, categoryId: string): Promise<any[]> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/store/categories/${categoryId}/items`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data?.code === '0') {
        return res.data.data || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  static async buyPackage(gameToken: string, packageId: string): Promise<any> {
    try {
      const res = await axios.get(`${GAME_BASE_URL}/game/store/${packageId}/subscribe`, {
        headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      try {
        return typeof res.data === 'object' ? res.data : JSON.parse(String(res.data));
      } catch {
        if (res.status === 200) return { code: '0', message: 'Success' };
        return null;
      }
    } catch {
      return null;
    }
  }

  // ---------- Leaderboard ----------
  static async getLeaderboard(gameToken: string): Promise<any> {
    try {
      // Try common endpoints used by the game
      const endpoints = [
        `${GAME_BASE_URL}/game/leaderboard`,
        `${GAME_BASE_URL}/user/leaderboard`,
        `${GAME_BASE_URL}/leaderboard`,
      ];
      for (const url of endpoints) {
        const res = await axios.get(url, {
          headers: { Authorization: `Bearer ${gameToken}`, 'Content-Type': 'application/json' },
          httpsAgent: myidHttpsAgent,
          timeout: 15000,
          validateStatus: () => true,
        });
        if (res.status === 200 && res.data) {
          const data = res.data.data || res.data;
          if (data && (data.top_players || data.players || Array.isArray(data))) {
            return data;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------- Loyalty / Balance / Point Exchange (MyID access_token) ----------
  // Endpoints from official MYID PRO PLUS web app:
  //   Point  → GET https://apis.mytel.com.mm/csm/v1.0/api/loyalty
  //   Balance/Data/Voice → GET https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=...&language=en
  //   Exchange → POST https://apis.mytel.com.mm/loyalty/api/v3.1/pack/exchange

  static formatMsisdn(raw: string): string {
    if (!raw) return '';
    const c = String(raw).trim().replace(/\s/g, '');
    if (c.startsWith('+959')) return c;
    if (c.startsWith('09')) return '+95' + c.slice(1);
    if (c.startsWith('959')) return '+' + c;
    if (c.startsWith('+95')) return c;
    const digits = c.replace(/\D/g, '');
    if (digits.startsWith('95')) return '+' + digits;
    if (digits.startsWith('09')) return '+95' + digits.slice(1);
    if (digits.startsWith('9')) return '+95' + digits;
    return c;
  }

  /** 1000MB → 1GB, 1500 → 1.5GB, under 1000 stays MB */
  static formatDataAmount(n: number | string, unitHint?: string): string {
    const num = typeof n === 'string' ? parseFloat(n.replace(/,/g, '')) : Number(n);
    if (!Number.isFinite(num)) return String(n);
    const hint = (unitHint || '').toUpperCase();
    // already GB from API
    if (hint.includes('GB')) {
      return num >= 1000
        ? `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)} TB`
        : `${Number(num.toFixed(num % 1 === 0 ? 0 : 1))} GB`;
    }
    // treat as MB by default
    if (num >= 1000) {
      const gb = num / 1000;
      const s = gb % 1 === 0 ? String(gb) : gb.toFixed(1).replace(/\.0$/, '');
      return `${s} GB`;
    }
    return `${Number.isInteger(num) ? num.toLocaleString() : num} MB`;
  }

  static formatVoiceAmount(n: number | string): string {
    const num = typeof n === 'string' ? parseFloat(n.replace(/,/g, '')) : Number(n);
    if (!Number.isFinite(num)) return String(n);
    return `${num.toLocaleString()} မိနစ်`;
  }

  /** Login with access token only — fetch account-main to resolve phone */
  static async loginWithAccessToken(token: string): Promise<MyIdSession | null> {
    const authHeaders: any = {
      ...MYID_HEADERS,
      Authorization: `Bearer ${token}`,
      'access-token': token,
      Accept: 'application/json',
    };
    const urls = [
      'https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=09666666666&language=en',
      'https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?language=en',
    ];
    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: authHeaders,
          httpsAgent: myidHttpsAgent,
          timeout: 20000,
          validateStatus: () => true,
        });
        if (res.data?.errorCode === 0 || res.data?.errorCode === '0') {
          const all = Array.isArray(res.data.result)
            ? res.data.result
            : res.data.result
              ? [res.data.result]
              : [];
          const account = all.find((a: any) => a && a.mytel === true) || all[0];
          if (!account) continue;
          let phone = String(account.msisdn || account.isdn || '').replace(/\D/g, '');
          if (phone.startsWith('95') && phone.length > 10) phone = phone.slice(2);
          if (phone.startsWith('0')) phone = phone.slice(1);
          return {
            phone: phone || 'unknown',
            access_token: token,
            full_name: account.name || account.fullName || account.customerName || '',
            avatar: account.avatar || 'https://s3.mytel.com.mm/myid-avatar/avatar/default.jpg',
            subId: account.subId ? String(account.subId) : undefined,
          };
        }
      } catch (e) {
        console.error('loginWithAccessToken error:', e);
      }
    }
    return null;
  }

  /** Point: result.balances[] loyaltyBalanceCode === TELCO_EXCHANGEABLE_POINTS */
  static parsePointFromResponse(data: any): string | undefined {
    try {
      if (data?.errorCode !== 0 && data?.errorCode !== '0') return undefined;
      const balances = data?.result?.balances;
      if (!Array.isArray(balances)) return undefined;
      for (const b of balances) {
        if (b?.loyaltyBalanceCode === 'TELCO_EXCHANGEABLE_POINTS') {
          const val = b?.balance;
          if (val !== undefined && val !== null && String(val).trim() !== '') return String(val);
        }
      }
    } catch {}
    return undefined;
  }

  /**
   * Account-main (web app):
   *   account.mainBalance.main/data/voice.amount (+ optional expire fields)
   * Android-style:
   *   result.accounts[] groupName Data|Voice + details[]
   * Also deep-scans entire JSON for package rows with expiry dates.
   */
  static extractDetailRow(d: any): { name: string; amount: string; expiry: string } | null {
    if (!d || typeof d !== 'object') return null;
    const name = d.name || d.packageName || d.description || d.offerName || d.type || d.productName || d.title || d.serviceName;
    const amount =
      d.amount ?? d.balance ?? d.remaining ?? d.totalBalance ?? d.value ?? d.remain ?? d.quota ?? d.volume;
    const expiry =
      d.expireDate ||
      d.expiryDate ||
      d.expiry ||
      d.validTo ||
      d.validUntil ||
      d.endDate ||
      d.expiredDate ||
      d.validity ||
      d.expireTime ||
      d.expirationDate ||
      d.expire ||
      d.dueDate ||
      d.toDate ||
      d.valid_to ||
      d.expired_time ||
      d.expDate ||
      d.dateExpire;
    // need at least name or amount to be useful
    if (name === undefined && amount === undefined && expiry === undefined) return null;
    // skip pure balance summary objects without package identity
    return {
      name: String(name ?? 'Package'),
      amount: amount !== undefined && amount !== null ? String(amount) : '—',
      expiry: expiry !== undefined && expiry !== null && String(expiry).trim() !== '' ? String(expiry) : '—',
    };
  }

  static deepFindDetails(node: any, path = ''): {
    data: Array<{ name: string; amount: string; expiry: string }>;
    voice: Array<{ name: string; amount: string; expiry: string }>;
    sms: Array<{ name: string; amount: string; expiry: string }>;
  } {
    const data: Array<{ name: string; amount: string; expiry: string }> = [];
    const voice: Array<{ name: string; amount: string; expiry: string }> = [];
    const sms: Array<{ name: string; amount: string; expiry: string }> = [];
    const seen = new Set<any>();

    const walk = (n: any, p: string, depth: number) => {
      if (!n || typeof n !== 'object' || depth > 8) return;
      if (seen.has(n)) return;
      seen.add(n);

      if (Array.isArray(n)) {
        // If this looks like a list of package detail objects
        const rows = n
          .map((item) => this.extractDetailRow(item))
          .filter(Boolean) as Array<{ name: string; amount: string; expiry: string }>;
        const withExpiry = rows.filter((r) => r.expiry && r.expiry !== '—');
        if (rows.length >= 1 && (withExpiry.length > 0 || rows.some((r) => r.name !== 'Package'))) {
          const pl = p.toLowerCase();
          if (pl.includes('voice') || pl.includes('call') || pl.includes('min')) {
            voice.push(...rows);
          } else if (pl.includes('sms') || pl.includes('message')) {
            sms.push(...rows);
          } else if (
            pl.includes('data') ||
            pl.includes('mb') ||
            pl.includes('internet') ||
            pl.includes('package') ||
            pl.includes('detail') ||
            pl.includes('offer') ||
            pl.includes('bundle')
          ) {
            data.push(...rows);
          } else if (withExpiry.length > 0) {
            // unknown path but has expiry — prefer data bucket
            data.push(...rows);
          }
        }
        for (let i = 0; i < n.length; i++) walk(n[i], p + '[' + i + ']', depth + 1);
        return;
      }

      for (const k of Object.keys(n)) {
        walk(n[k], p ? p + '.' + k : k, depth + 1);
      }
    };

    walk(node, path, 0);
    // dedupe by name+amount+expiry
    const dedupe = (arr: typeof data) => {
      const s = new Set<string>();
      return arr.filter((r) => {
        const key = r.name + '|' + r.amount + '|' + r.expiry;
        if (s.has(key)) return false;
        s.add(key);
        return true;
      });
    };
    return { data: dedupe(data), voice: dedupe(voice), sms: dedupe(sms) };
  }

  static parseAccountMainResponse(data: any): {
    balance?: string;
    mb?: string;
    voice?: string;
    sms?: string;
    msisdn?: string;
    dataDetails?: Array<{ name: string; amount: string; expiry: string }>;
    voiceDetails?: Array<{ name: string; amount: string; expiry: string }>;
    smsDetails?: Array<{ name: string; amount: string; expiry: string }>;
  } {
    const out: {
      balance?: string;
      mb?: string;
      voice?: string;
      sms?: string;
      msisdn?: string;
      dataDetails?: Array<{ name: string; amount: string; expiry: string }>;
      voiceDetails?: Array<{ name: string; amount: string; expiry: string }>;
      smsDetails?: Array<{ name: string; amount: string; expiry: string }>;
    } = {};
    try {
      if (data?.errorCode !== 0 && data?.errorCode !== '0' && data?.errorCode !== '00000') {
        return out;
      }

      const all = Array.isArray(data?.result)
        ? data.result
        : data?.result
          ? [data.result]
          : [];
      const account = all.find((a: any) => a && a.mytel === true) || all[0];

      if (account) {
        if (account.msisdn) out.msisdn = String(account.msisdn);
        const mb = account.mainBalance;
        if (mb) {
          if (mb.main?.amount !== undefined && mb.main?.amount !== null) {
            out.balance = String(mb.main.amount);
          }
          if (mb.data?.amount !== undefined && mb.data?.amount !== null) {
            out.mb = String(mb.data.amount);
          }
          if (mb.voice?.amount !== undefined && mb.voice?.amount !== null) {
            out.voice = String(mb.voice.amount);
          }
          if (mb.sms?.amount !== undefined && mb.sms?.amount !== null) {
            out.sms = String(mb.sms.amount);
          }

          // Single-bucket expiry on mainBalance.data/voice/sms
          const pushOne = (
            bucket: 'data' | 'voice' | 'sms',
            obj: any,
            total?: string
          ) => {
            if (!obj || typeof obj !== 'object') return;
            const row = this.extractDetailRow({
              ...obj,
              amount: obj.amount ?? total,
              name: obj.name || (bucket === 'data' ? 'Data' : bucket === 'voice' ? 'Voice' : 'SMS'),
            });
            if (!row) return;
            if (bucket === 'data') {
              out.dataDetails = out.dataDetails || [];
              out.dataDetails.push(row);
            } else if (bucket === 'voice') {
              out.voiceDetails = out.voiceDetails || [];
              out.voiceDetails.push(row);
            } else {
              out.smsDetails = out.smsDetails || [];
              out.smsDetails.push(row);
            }
          };
          pushOne('data', mb.data, out.mb);
          pushOne('voice', mb.voice, out.voice);
          pushOne('sms', mb.sms, out.sms);

          // Nested lists under mainBalance
          for (const key of ['details', 'packages', 'list', 'items', 'offers', 'bundles']) {
            if (Array.isArray(mb.data?.[key])) {
              const rows = mb.data[key]
                .map((x: any) => this.extractDetailRow(x))
                .filter(Boolean) as any[];
              if (rows.length) out.dataDetails = [...(out.dataDetails || []), ...rows];
            }
            if (Array.isArray(mb.voice?.[key])) {
              const rows = mb.voice[key]
                .map((x: any) => this.extractDetailRow(x))
                .filter(Boolean) as any[];
              if (rows.length) out.voiceDetails = [...(out.voiceDetails || []), ...rows];
            }
            if (Array.isArray(mb.sms?.[key])) {
              const rows = mb.sms[key]
                .map((x: any) => this.extractDetailRow(x))
                .filter(Boolean) as any[];
              if (rows.length) out.smsDetails = [...(out.smsDetails || []), ...rows];
            }
          }
        }

        // Android accounts[] on account object
        if (Array.isArray(account.accounts)) {
          for (const acc of account.accounts) {
            const group = String(acc?.groupName || '');
            if (acc?.totalBalance != null) {
              if (group === 'Data' && !out.mb) out.mb = String(acc.totalBalance);
              if (group === 'Voice' && !out.voice) out.voice = String(acc.totalBalance);
              if ((group === 'SMS' || group === 'Sms') && !out.sms) out.sms = String(acc.totalBalance);
            }
            if (Array.isArray(acc?.details)) {
              const rows = acc.details
                .map((x: any) => this.extractDetailRow(x))
                .filter(Boolean) as any[];
              if (group === 'Data' && rows.length) out.dataDetails = rows;
              if (group === 'Voice' && rows.length) out.voiceDetails = rows;
              if ((group === 'SMS' || group === 'Sms') && rows.length) out.smsDetails = rows;
            }
          }
        }
      }

      // Android-style result (not array)
      const result = data?.result;
      if (result && !Array.isArray(result)) {
        try {
          const mainAmount = result?.generalInfo?.mainBalance?.balance;
          if (mainAmount !== undefined && mainAmount !== null && !out.balance) {
            out.balance = String(mainAmount);
          }
        } catch {}
        try {
          const accounts = result?.accounts;
          if (Array.isArray(accounts)) {
            for (const acc of accounts) {
              const group = String(acc?.groupName || '');
              const total = acc?.totalBalance;
              if (total !== undefined && total !== null) {
                if (group === 'Data' && !out.mb) out.mb = String(total);
                else if (group === 'Voice' && !out.voice) out.voice = String(total);
                else if ((group === 'SMS' || group === 'Sms') && !out.sms) out.sms = String(total);
              }
              if (Array.isArray(acc?.details) && acc.details.length) {
                const details = acc.details
                  .map((d: any) => this.extractDetailRow(d))
                  .filter(Boolean) as any[];
                if (group === 'Data') out.dataDetails = details;
                if (group === 'Voice') out.voiceDetails = details;
                if (group === 'SMS' || group === 'Sms') out.smsDetails = details;
              }
            }
          }
        } catch {}
      }

      // Deep scan whole payload for any missed detail lists with expiry
      const deep = this.deepFindDetails(data);
      if ((!out.dataDetails || out.dataDetails.length === 0) && deep.data.length) {
        out.dataDetails = deep.data;
      }
      if ((!out.voiceDetails || out.voiceDetails.length === 0) && deep.voice.length) {
        out.voiceDetails = deep.voice;
      }
      if ((!out.smsDetails || out.smsDetails.length === 0) && deep.sms.length) {
        out.smsDetails = deep.sms;
      }
      // If still no typed details but deep found generic data with expiry
      if (
        (!out.dataDetails || out.dataDetails.every((d) => d.expiry === '—')) &&
        deep.data.some((d) => d.expiry !== '—')
      ) {
        out.dataDetails = deep.data;
      }
    } catch {}
    return out;
  }

  static async getLoyaltyAccountInfo(session: MyIdSession): Promise<{
    ok: boolean;
    raw?: any;
    mb?: string;
    balance?: string;
    point?: string;
    voice?: string;
    sms?: string;
    message?: string;
    dataDetails?: Array<{ name: string; amount: string; expiry: string }>;
    voiceDetails?: Array<{ name: string; amount: string; expiry: string }>;
    smsDetails?: Array<{ name: string; amount: string; expiry: string }>;
  }> {
    const phone = (session.phone || '').replace(/\D/g, '');
    // isdn for account-main: 09xxxxxxxx style preferred
    let isdn = phone;
    if (isdn.startsWith('95') && isdn.length >= 11) isdn = '0' + isdn.slice(2);
    if (!isdn.startsWith('0') && isdn.startsWith('9')) isdn = '0' + isdn;

    const authHeaders: any = {
      ...MYID_HEADERS,
      Authorization: `Bearer ${session.access_token}`,
      'access-token': session.access_token,
      Accept: 'application/json',
    };

    let point: string | undefined;
    let balance: string | undefined;
    let mb: string | undefined;
    let voice: string | undefined;
    let sms: string | undefined;
    let dataDetails: Array<{ name: string; amount: string; expiry: string }> | undefined;
    let voiceDetails: Array<{ name: string; amount: string; expiry: string }> | undefined;
    let smsDetails: Array<{ name: string; amount: string; expiry: string }> | undefined;
    const raws: any[] = [];

    // 1) Points — exact endpoint from MYID PRO PLUS
    try {
      const res = await axios.get('https://apis.mytel.com.mm/csm/v1.0/api/loyalty', {
        headers: authHeaders,
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.data) {
        raws.push(res.data);
        const p = this.parsePointFromResponse(res.data);
        if (p !== undefined) point = p;
      }
    } catch (e) {
      console.error('loyalty points fetch error:', e);
    }

    // 2) Balance / Data / Voice — account-main (token scopes the real account)
    // Android uses isdn=%2B959xxxxxxxx
    const isdnPlus = this.formatMsisdn(session.phone || isdn);
    const accountUrls = [
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=${encodeURIComponent(isdnPlus)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=${encodeURIComponent(isdn)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=${encodeURIComponent(phone)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-main?isdn=09666666666&language=en`,
      // possible detail variants
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/account-detail?isdn=${encodeURIComponent(isdnPlus)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/balances?isdn=${encodeURIComponent(isdnPlus)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.2/individual/packages?isdn=${encodeURIComponent(isdnPlus)}&language=en`,
      `https://apis.mytel.com.mm/account-detail/api/v1.1/individual/account-main?isdn=${encodeURIComponent(isdnPlus)}&language=en`,
    ];

    for (const url of accountUrls) {
      try {
        const res = await axios.get(url, {
          headers: authHeaders,
          httpsAgent: myidHttpsAgent,
          timeout: 15000,
          validateStatus: () => true,
        });
        if (res.data) {
          raws.push(res.data);
          const parsed = this.parseAccountMainResponse(res.data);
          if (parsed.balance) balance = parsed.balance;
          if (parsed.mb) mb = parsed.mb;
          if (parsed.voice) voice = parsed.voice;
          if (parsed.sms) sms = parsed.sms;
          if (parsed.dataDetails?.length) dataDetails = parsed.dataDetails;
          if (parsed.voiceDetails?.length) voiceDetails = parsed.voiceDetails;
          if (parsed.smsDetails?.length) smsDetails = parsed.smsDetails;
          if (balance || mb || voice) break;
        }
      } catch (e) {
        console.error('account-main fetch error:', e);
      }
    }

    if (point || balance || mb || voice || sms) {
      return {
        ok: true,
        raw: raws.length ? raws[raws.length - 1] : undefined,
        point,
        balance,
        mb,
        voice,
        sms,
        dataDetails,
        voiceDetails,
        smsDetails,
      };
    }

    if (raws.length) {
      return {
        ok: false,
        raw: raws[0],
        message:
          'API တုံ့ပြန်မှု ရရှိသော်လည်း Balance / Data / Point field များကို မဖတ်နိုင်ပါ။',
      };
    }
    return { ok: false, message: 'Loyalty / Balance API မှ အချက်အလက် မရရှိပါ။' };
  }

  static async exchangePack(
    session: MyIdSession,
    rewardCode: string
  ): Promise<{ ok: boolean; message: string; raw?: any }> {
    const msisdn = this.formatMsisdn(session.phone || '');
    const requestId =
      'web_' + crypto.randomBytes(6).toString('hex') + '_' + Date.now().toString(36);
    const body = {
      msisdn,
      rewardCode,
      requestId,
      requestTime: String(Date.now()),
    };
    try {
      const res = await axios.post(
        'https://apis.mytel.com.mm/loyalty/api/v3.1/pack/exchange',
        body,
        {
          headers: {
            ...MYID_HEADERS,
            Authorization: `Bearer ${session.access_token}`,
            'access-token': session.access_token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          httpsAgent: myidHttpsAgent,
          timeout: 20000,
          validateStatus: () => true,
        }
      );
      const data = res.data;
      const code = data?.errorCode ?? data?.code ?? res.status;
      const msg =
        data?.message ||
        data?.errorMessage ||
        data?.msg ||
        (typeof data === 'string' ? data : JSON.stringify(data || {}).slice(0, 200));

      // Success patterns used by MyTel APIs
      if (
        res.status === 200 &&
        (code === 200 || code === '200' || code === 0 || code === '0' || data?.success === true)
      ) {
        return { ok: true, message: msg || 'Exchange အောင်မြင်ပါသည်။', raw: data };
      }
      return { ok: false, message: msg || `Exchange မအောင်မြင်ပါ (HTTP ${res.status})`, raw: data };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error' };
    }
  }

  /** Buy Mytel VAS package (main balance ကျပ်) — MYID PRO PLUS web app */
  static async buyVasPackage(
    session: MyIdSession,
    packageId: string
  ): Promise<{ ok: boolean; message: string; raw?: any }> {
    const msisdn = this.formatMsisdn(session.phone || '').replace(/^\+/, '');
    const requestId =
      'pkg_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const body = {
      msisdn,
      rewardCode: packageId,
      requestId,
      requestTime: String(Date.now()),
    };
    try {
      const res = await axios.post(
        `https://apis.mytel.com.mm/csm/v1.0/api/vas-package/${encodeURIComponent(packageId)}/register`,
        body,
        {
          headers: {
            ...MYID_HEADERS,
            Authorization: `Bearer ${session.access_token}`,
            'access-token': session.access_token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          httpsAgent: myidHttpsAgent,
          timeout: 25000,
          validateStatus: () => true,
        }
      );
      const data = res.data;
      const code = data?.errorCode ?? data?.code ?? res.status;
      const msg =
        data?.message ||
        data?.errorMessage ||
        data?.msg ||
        (typeof data === 'string' ? data : JSON.stringify(data || {}).slice(0, 200));

      if (
        res.status === 200 &&
        (code === 0 || code === '0' || code === 200 || code === '200' || data?.success === true)
      ) {
        return { ok: true, message: msg || 'Package ဝယ်ယူမှု အောင်မြင်ပါသည်။', raw: data };
      }
      return {
        ok: false,
        message: msg || `ဝယ်ယူမှု မအောင်မြင်ပါ (HTTP ${res.status})`,
        raw: data,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error' };
    }
  }

  /**
   * Point History — MYID PRO PLUS
   * GET /loyalty/api/v3.1/history?phoneNo=...&type=EARN|BURN&page=0&size=100
   * errorCode === '00000', result.content[] = { reason, amount, updateTime }
   */
  static async getPointHistory(
    session: MyIdSession,
    type: 'EARN' | 'BURN',
    page = 0,
    size = 20
  ): Promise<{
    ok: boolean;
    items: Array<{ reason: string; amount: string; time: string }>;
    message?: string;
    raw?: any;
  }> {
    const phone = this.formatMsisdn(session.phone || '');
    // API accepts +959... or 09... — web app uses account.msisdn as stored
    const phoneNo = phone || session.phone || '';
    const url =
      `https://apis.mytel.com.mm/loyalty/api/v3.1/history` +
      `?phoneNo=${encodeURIComponent(phoneNo)}` +
      `&type=${type}&page=${page}&size=${size}`;

    try {
      const res = await axios.get(url, {
        headers: {
          ...MYID_HEADERS,
          Authorization: `Bearer ${session.access_token}`,
          'access-token': session.access_token,
          Accept: 'application/json',
        },
        httpsAgent: myidHttpsAgent,
        timeout: 15000,
        validateStatus: () => true,
      });
      const data = res.data;
      if (
        data &&
        (data.errorCode === '00000' || data.errorCode === 0 || data.errorCode === '0') &&
        data.result &&
        Array.isArray(data.result.content)
      ) {
        const items = data.result.content.map((item: any) => {
          let time = '';
          try {
            const t = item.updateTime || item.createTime || item.time || '';
            if (t) {
              const d = new Date(t);
              time = Number.isNaN(d.getTime())
                ? String(t)
                : d.toLocaleString('en-GB', { hour12: false });
            }
          } catch {
            time = String(item.updateTime || '');
          }
          return {
            reason: String(item.reason || item.description || item.title || '—'),
            amount: String(item.amount ?? item.point ?? item.points ?? '0'),
            time,
          };
        });
        return { ok: true, items, raw: data };
      }
      return {
        ok: false,
        items: [],
        message: data?.message || 'History မရရှိပါ။',
        raw: data,
      };
    } catch (e: any) {
      return { ok: false, items: [], message: e?.message || 'Network error' };
    }
  }

  /**
   * Daily Quest Claim
   * POST https://apis.mytel.com.mm/daily-quest-v3/api/v3/daily-quest/daily-claim
   * Body: msisdn, rewardCode, requestId, requestTime
   */
  static async dailyQuestClaim(
    session: MyIdSession,
    rewardCode = 'DAILY_CLAIM'
  ): Promise<{ ok: boolean; message: string; raw?: any }> {
    const msisdn = this.formatMsisdn(session.phone || '');
    const body = {
      msisdn,
      rewardCode,
      requestId: crypto.randomBytes(8).toString('hex'),
      requestTime: String(Date.now()),
    };
    try {
      const res = await axios.post(
        'https://apis.mytel.com.mm/daily-quest-v3/api/v3/daily-quest/daily-claim',
        body,
        {
          headers: {
            ...MYID_HEADERS,
            Authorization: `Bearer ${session.access_token}`,
            'access-token': session.access_token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          httpsAgent: myidHttpsAgent,
          timeout: 20000,
          validateStatus: () => true,
        }
      );
      const data = res.data;
      const code = data?.errorCode ?? data?.code ?? res.status;
      const msg =
        data?.message ||
        data?.errorMessage ||
        data?.msg ||
        (typeof data === 'string' ? data : JSON.stringify(data || {}).slice(0, 200));

      if (
        res.status === 200 &&
        (code === 0 ||
          code === '0' ||
          code === 200 ||
          code === '200' ||
          code === '00000' ||
          data?.success === true)
      ) {
        return { ok: true, message: msg || 'Daily Claim အောင်မြင်ပါသည်။', raw: data };
      }
      return { ok: false, message: msg || `Claim မအောင်မြင်ပါ (HTTP ${res.status})`, raw: data };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error' };
    }
  }

  /**
   * Network Test submit (earn points) — one operator
   * POST https://apis.mytel.com.mm/network-test/v3/submit
   */
  static async submitNetworkTest(
    session: MyIdSession,
    operator: 'ATOM' | 'MYTEL' | 'OOREDOO' | 'MPT'
  ): Promise<{ ok: boolean; message: string; operator: string; raw?: any }> {
    const msisdn = this.formatMsisdn(session.phone || '');
    // Android app uses +959... style
    const msisdnPlus = msisdn.startsWith('+')
      ? msisdn
      : msisdn.startsWith('959')
        ? '+' + msisdn
        : this.formatMsisdn(session.phone || '');

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const requestTime =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const requestId =
      (msisdnPlus.replace(/\D/g, '') || 'req') + '_' + Date.now().toString(36);

    const body = {
      cellId: '51273751',
      deviceModel: 'Redmi Note 8 Pro',
      downloadSpeed: 0.8 + Math.random() * 5,
      enb: '200288',
      latency: 50 + Math.random() * 200,
      latitude: '21.4631248',
      location: 'Mandalay Region, Myanmar (Burma)',
      longitude: '95.3621706',
      msisdn: msisdnPlus,
      networkType: '_4G',
      operator,
      requestId,
      requestTime,
      rsrp: '-98',
      township: 'Mandalay Region',
      uploadSpeed: 5 + Math.random() * 15,
    };

    try {
      const res = await axios.post(
        'https://apis.mytel.com.mm/network-test/v3/submit',
        body,
        {
          headers: {
            ...MYID_HEADERS,
            Authorization: `Bearer ${session.access_token}`,
            'access-token': session.access_token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          httpsAgent: myidHttpsAgent,
          timeout: 20000,
          validateStatus: () => true,
        }
      );
      const data = res.data;
      const code = data?.errorCode ?? data?.code ?? res.status;
      const msg =
        data?.message ||
        data?.errorMessage ||
        data?.msg ||
        (typeof data === 'string' ? data : JSON.stringify(data || {}).slice(0, 150));

      if (
        res.status === 200 &&
        (code === 0 ||
          code === '0' ||
          code === 200 ||
          code === '200' ||
          code === '00000' ||
          data?.success === true)
      ) {
        return {
          ok: true,
          operator,
          message: msg || `${operator} Network Test အောင်မြင်`,
          raw: data,
        };
      }
      return {
        ok: false,
        operator,
        message: msg || `${operator} failed (HTTP ${res.status})`,
        raw: data,
      };
    } catch (e: any) {
      return { ok: false, operator, message: e?.message || 'Network error' };
    }
  }

  /** Submit network test for all 4 operators sequentially */
  static async submitAllNetworkTests(session: MyIdSession): Promise<{
    results: Array<{ ok: boolean; operator: string; message: string }>;
  }> {
    const operators: Array<'ATOM' | 'MYTEL' | 'OOREDOO' | 'MPT'> = [
      'ATOM',
      'MYTEL',
      'OOREDOO',
      'MPT',
    ];
    const results: Array<{ ok: boolean; operator: string; message: string }> = [];
    for (const op of operators) {
      const r = await this.submitNetworkTest(session, op);
      results.push({ ok: r.ok, operator: r.operator, message: r.message });
      // small delay between operators
      await new Promise((res) => setTimeout(res, 800));
    }
    return { results };
  }
}

/** Point Exchange packages (Super + Data + Voice + SMS) */
const MYID_EXCHANGE_PACKS = {
  super: [
    { data: '5,000MB (once/month)', price: '1000', code: 'PACK_MYID_PRO', unit: 'MB' },
    { data: '87,500', price: '25000', code: 'DATA_87500MB', unit: 'MB' },
    { data: '55,250', price: '17000', code: 'DATA_MB55250MB', unit: 'MB' },
    { data: '36,000', price: '12000', code: 'DATA_36000MB', unit: 'MB' },
    { data: '22,000', price: '8000', code: 'DATA_22000MB', unit: 'MB' },
  ],
  data: [
    { data: '2750', price: '1000', code: 'DATA_2750MB', unit: 'MB' },
    { data: '2000', price: '800', code: 'DATA_2000MB', unit: 'MB' },
    { data: '1350', price: '600', code: 'DATA_1350MB', unit: 'MB' },
    { data: '800', price: '400', code: 'DATA_800MB', unit: 'MB' },
    { data: '300', price: '200', code: 'DATA_300MB', unit: 'MB' },
    { data: '100', price: '100', code: 'DATA_100MB', unit: 'MB' },
    { data: '40', price: '50', code: 'DATA_40MB', unit: 'MB' },
  ],
  voice: [
    { data: '400 On-Net', price: '800', code: 'VOICE_400MIN', unit: 'Min' },
    { data: '270 On-Net', price: '600', code: 'VOICE_270MIN', unit: 'Min' },
    { data: '160 On-Net', price: '400', code: 'VOICE_160MIN', unit: 'Min' },
    { data: '60 On-Net', price: '200', code: 'VOICE_60MIN', unit: 'Min' },
    { data: '20 On-Net', price: '100', code: 'VOICE_20MIN', unit: 'Min' },
    { data: '8 On-Net', price: '50', code: 'VOICE_8MIN', unit: 'Min' },
  ],
  sms: [
    { data: '27500', price: '1000', code: 'SMS_27500', unit: 'SMS' },
    { data: '20000', price: '800', code: 'SMS_20000', unit: 'SMS' },
    { data: '13500', price: '600', code: 'SMS_13500', unit: 'SMS' },
    { data: '8000', price: '400', code: 'SMS_8000', unit: 'SMS' },
    { data: '3000', price: '200', code: 'SMS_3000', unit: 'SMS' },
    { data: '1000', price: '100', code: 'SMS_1000', unit: 'SMS' },
    { data: '400', price: '50', code: 'SMS_400', unit: 'SMS' },
  ],
} as const;

function findExchangePack(code: string) {
  for (const cat of Object.keys(MYID_EXCHANGE_PACKS) as (keyof typeof MYID_EXCHANGE_PACKS)[]) {
    const found = MYID_EXCHANGE_PACKS[cat].find((p) => p.code === code);
    if (found) return { ...found, category: cat };
  }
  return null;
}

/** Mytel VAS packages (ကျပ်) — from MYID PRO PLUS web app */
const MYTEL_VAS_PACKAGES = {
  data: [
    { id: 'SH135', name: 'SH135 Package', desc: '13,333 MB', price: '13500', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'S92', name: 'S92 Package', desc: '2GB + 22 Mytel Minutes', price: '1999', unit: 'ကျပ်', days: '7 Days', hot: true },
    { id: 'TT3', name: 'TT3 Package', desc: '1.2GB TikTok (3 days)', price: '999', unit: 'ကျပ်', days: '3 Days' },
    { id: 'GG3', name: 'GG3 Package', desc: '1.2GB YouTube (3 days)', price: '999', unit: 'ကျပ်', days: '3 Days' },
    { id: 'MD1', name: 'MD1 Package', desc: '400 MB (24 Hours)', price: '400', unit: 'ကျပ်', days: '1 Day' },
    { id: 'TT1', name: 'TT1 Package', desc: '500MB TikTok (24 Hours)', price: '500', unit: 'ကျပ်', days: '1 Day' },
    { id: 'TG1', name: 'TG1 Package', desc: '500MB Telegram (24 Hours)', price: '500', unit: 'ကျပ်', days: '1 Day' },
    { id: 'SH70', name: 'SH70 Package', desc: '6,666 MB', price: '7000', unit: 'ကျပ်', days: '15 Days' },
    { id: 'S91', name: 'S91 Package', desc: '1GB + 150 Points (E-Money)', price: '999', unit: 'ကျပ်', days: '3 Days' },
    { id: 'MD2', name: 'MD2 Package', desc: '800 MB', price: '800', unit: 'ကျပ်', days: '1 Day' },
  ],
  voice: [
    { id: 'AN9', name: 'AN9 Package', desc: '131 Any-network Minutes', price: '2499', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'HL20', name: 'HL20 Package', desc: '160 On-net Minutes + 160 On-net SMS', price: '2000', unit: 'ကျပ်', days: '30 Days' },
    { id: 'AN2', name: 'AN2 Package', desc: '14 Any-network Minutes', price: '299', unit: 'ကျပ်', days: '3 Days' },
    { id: 'HL10', name: 'HL10 Package', desc: '78 On-net Minutes + 78 On-net SMS', price: '1000', unit: 'ကျပ်', days: '7 Days' },
    { id: 'AN8', name: 'AN8 Package', desc: '45 Any-network Minutes', price: '899', unit: 'ကျပ်', days: '10 Days' },
    { id: 'HL2', name: 'HL2 Package', desc: '15 On-net Minutes + 15 On-net SMS (24 Hours)', price: '200', unit: 'ကျပ်', days: '1 Day' },
  ],
  combo: [
    { id: 'BC15', name: 'BC15 Package', desc: '14GB + 1050 Minutes', price: '15000', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'BC25', name: 'BC25 Package', desc: '24GB + 3150 Minutes', price: '25000', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'BC20', name: 'BC20 Package', desc: '19GB + 2100 Minutes', price: '20000', unit: 'ကျပ်', days: '30 Days' },
    { id: 'BC30', name: 'BC30 Package', desc: '29GB + 4200 Minutes', price: '30000', unit: 'ကျပ်', days: '30 Days' },
    { id: 'X3333', name: 'X3333 Package', desc: '19,998 Ks Promo (X6 times)', price: '3333', unit: 'ကျပ်', days: '30 Days' },
    { id: 'X7777', name: 'X7777 Package', desc: '46,662 Ks Promo (X6 times)', price: '7777', unit: 'ကျပ်', days: '30 Days' },
    { id: 'X1111', name: 'X1111 Package', desc: '6,666 Ks Promo (X6 times)', price: '1111', unit: 'ကျပ်', days: '30 Days' },
    { id: 'X777', name: 'X777 Package', desc: '4,662 Ks Promo (X6 times)', price: '777', unit: 'ကျပ်', days: '30 Days' },
    { id: 'X11', name: 'X11 Package', desc: '11,000 Ks Promo (X11 times)', price: '1000', unit: 'ကျပ်', days: '30 Days' },
  ],
  shareable: [
    { id: 'SH500', name: 'SH500 Package', desc: '168 MB (Shareable)', price: '555', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'SH1299', name: 'SH1299 Package', desc: '564 MB (Shareable) + 564 Mytel SMS', price: '1299', unit: 'ကျပ်', days: '30 Days' },
    { id: 'SH8', name: 'SH8 Package', desc: '269 MB (Shareable) + 269 Mytel SMS', price: '888', unit: 'ကျပ်', days: '30 Days' },
    { id: 'SH200', name: 'SH200 Package', desc: '20,000 MB', price: '20000', unit: 'ကျပ်', days: '30 Days', hot: true },
    { id: 'D3', name: 'S3 Package', desc: '100 MB + 100 SMS', price: '333', unit: 'ကျပ်', days: '1 Day' },
    { id: 'SH1799', name: 'SH1799 Package', desc: '782 MB (Shareable) + 782 Mytel SMS', price: '1799', unit: 'ကျပ်', days: '30 Days' },
    { id: 'SH35', name: 'SH35 Package', desc: '3,333 MB', price: '3500', unit: 'ကျပ်', days: '30 Days' },
    { id: 'P1', name: 'P1 Package', desc: '48 MB (24 Hours)', price: '111', unit: 'ကျပ်', days: '1 Day' },
    { id: 'SH968', name: 'SH968 Package', desc: '300 MB (Shareable) + 300 SMS', price: '999', unit: 'ကျပ်', days: '30 Days' },
  ],
  roaming: [
    { id: 'DRTH1', name: 'Thailand Data Roaming', desc: '2GB Data Roaming in Thailand', price: '4500', unit: 'ကျပ်', days: '3 Days', hot: true },
    { id: 'DRTH2', name: 'Thailand Data Roaming', desc: '5GB Data Roaming in Thailand', price: '9500', unit: 'ကျပ်', days: '7 Days' },
    { id: 'DR8', name: 'Non-Stop Data Roaming', desc: 'Roaming 8Ks/MB (Multiple Countries)', price: '1000', unit: 'ကျပ်', days: '7 Days' },
    { id: 'HM25', name: 'International Calls Monthly', desc: 'Call 50Ks/min (8 countries)', price: '400', unit: 'ကျပ်', days: '30 Days' },
    { id: 'DRVN1', name: 'Vietnam Data Roaming', desc: '1GB Roaming in Vietnam', price: '2500', unit: 'ကျပ်', days: '3 Days' },
    { id: 'DRVN2', name: 'Vietnam Data Roaming', desc: '3GB Roaming in Vietnam', price: '6500', unit: 'ကျပ်', days: '30 Days' },
    { id: 'HW25', name: 'International Calls Weekly', desc: 'Call 50Ks/min (8 countries)', price: '150', unit: 'ကျပ်', days: '7 Days' },
  ],
} as const;

function findVasPackage(id: string) {
  for (const cat of Object.keys(MYTEL_VAS_PACKAGES) as (keyof typeof MYTEL_VAS_PACKAGES)[]) {
    const found = MYTEL_VAS_PACKAGES[cat].find((p) => p.id === id);
    if (found) return { ...found, category: cat };
  }
  return null;
}



// Debug: show what dotenv actually loaded
const rawToken = (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
console.log('[debug] cwd =', process.cwd());
console.log('[debug] TELEGRAM_BOT_TOKEN length =', rawToken.length);
console.log('[debug] TELEGRAM_BOT_TOKEN starts =', rawToken ? rawToken.slice(0, 10) + '...' : '(empty)');

if (!rawToken || rawToken.includes('your_bot_token') || rawToken.length < 30) {
  console.error('❌ TELEGRAM_BOT_TOKEN မတွေ့ပါ / တိုလွန်း / မမှန်ပါ။');
  console.error('   .env ဥပမာ (space နဲ့ quote မပါရ):');
  console.error('   TELEGRAM_BOT_TOKEN=123456:AAF...');
  console.error('   လက်ရှိ process.env keys:', Object.keys(process.env).filter(k => k.includes('TOKEN') || k.includes('TELEGRAM') || k.includes('ADMIN')).join(', ') || '(none)');
  process.exit(1);
}

export const BOT_TOKEN = rawToken;

// ==================== PIRATE WAR (Private War) ====================
const PIRATE_API = 'https://api-piratemya.ugame.vn/api/';
const PIRATE_AES_KEY = 'agerg&ujiwe@76362YGVdehnjn';
const pirateHttpsAgent = new https.Agent({ rejectUnauthorized: false });

interface PirateSession {
  gameToken: string;
  mytelJwt: string;
  phone?: string;
}

const pirateSessions = new Map<number, PirateSession>();
/** userId → true when user requested stop during Auto Battle */
const pirateStopFlags = new Map<number, boolean>();

class PirateWarService {
  static encrypt(payload: Record<string, any>): string {
    return CryptoJS.AES.encrypt(JSON.stringify(payload), PIRATE_AES_KEY).toString();
  }

  static async login(mytelJwt: string): Promise<{ ok: boolean; gameToken?: string; message?: string }> {
    try {
      const res = await axios.post(
        PIRATE_API + 'user/login',
        { token: mytelJwt },
        {
          headers: { 'Content-Type': 'application/json' },
          httpsAgent: pirateHttpsAgent,
          timeout: 20000,
          validateStatus: () => true,
        }
      );
      if (res.data?.errorCode === 0 && res.data?.data?.accessToken) {
        return { ok: true, gameToken: res.data.data.accessToken };
      }
      const msg =
        typeof res.data?.message === 'object'
          ? res.data.message?.msgCode || JSON.stringify(res.data.message)
          : res.data?.message || 'Login failed';
      return { ok: false, message: String(msg) };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error' };
    }
  }

  static async post(
    gameToken: string,
    path: string,
    payload: Record<string, any> = {}
  ): Promise<any> {
    const body =
      payload && Object.keys(payload).length > 0
        ? { data: this.encrypt(payload) }
        : undefined;
    const res = await axios.post(PIRATE_API + path, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gameToken}`,
      },
      httpsAgent: pirateHttpsAgent,
      timeout: 30000,
      validateStatus: () => true,
    });
    const json = res.data || {};
    if (json.errorCode === undefined) json.errorCode = -1;
    return json;
  }

  static fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\\.0$/, '') + 'K';
    return String(n);
  }

  static async getProfile(gameToken: string): Promise<{
    ok: boolean;
    text?: string;
    island?: any;
    message?: string;
  }> {
    try {
      const resp = await this.post(gameToken, 'island/info', {});
      if (resp.errorCode !== 0) {
        return { ok: false, message: resp.message || 'Profile မရပါ' };
      }
      const island = resp.data?.island || resp.data || {};
      const text =
        `⛵ <b>Pirate War Profile</b>\n` +
        `════════════════════\n\n` +
        `👤 ${island.username || '—'}\n` +
        `📱 ${island.phone || island.msisdn || '—'}\n` +
        `⭐ Level: ${island.level ?? '—'}\n\n` +
        `💎 Diamond: ${this.fmt(island.PVF || 0)}\n` +
        `💰 Gold: ${this.fmt(island.PVG || 0)}\n` +
        `⚡ Energy: ${this.fmt(island.energy || 0)}\n` +
        `🪨 Stones: ${this.fmt(island.energyStone || 0)}\n`;
      return { ok: true, text, island };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Error' };
    }
  }

  static async getLineup(gameToken: string): Promise<{
    ok: boolean;
    shipIds: string[];
    message?: string;
  }> {
    const resp = await this.post(gameToken, 'pve/get-line-ups', {});
    if (resp.errorCode !== 0) return { ok: false, shipIds: [], message: 'Lineup မရပါ' };
    const lineup = (resp.data?.islandPveLineup || resp.data || [])[0];
    if (!lineup) return { ok: false, shipIds: [], message: 'Ship မရှိပါ' };
    const shipIds: string[] = [];
    for (const slot of ['slot1', 'slot2', 'slot3']) {
      const s = lineup[slot];
      if (s?.id) shipIds.push(String(s.id));
    }
    return shipIds.length ? { ok: true, shipIds } : { ok: false, shipIds: [], message: 'Ship မရှိပါ' };
  }

  static getMsgCode(resp: any): string | null {
    if (!resp) return null;
    const m = resp.message;
    if (m && typeof m === 'object' && m.msgCode) return String(m.msgCode);
    if (typeof m === 'string' || typeof m === 'number') return String(m);
    return null;
  }

  /** Official client closes stuck session with Lose + 0 HP */
  static async closeStuckSession(gameToken: string, sessionId: any) {
    if (!sessionId) return;
    try {
      await this.post(gameToken, 'pve/update-result', {
        matchId: sessionId,
        result: 'Lose',
        listShipHp: JSON.stringify([0]),
        star: 0,
        timestamp: new Date().toUTCString(),
      });
    } catch {}
  }

  /**
   * Official HTML logic:
   *  9014 = stuck session → close with Lose, wait 5s, retry
   *  9016 = ship durability broken → wait 15s once, then skip level
   *  9005 = out of energy → stop
   */
  static async pveChapter(
    gameToken: string,
    chapterId: string | number,
    shipIds: string[],
    onLog?: (msg: string) => Promise<void>
  ): Promise<{ ok: true; data: any } | { ok: false; error: string; fatal?: boolean }> {
    const note = async (m: string) => {
      if (onLog) await onLog(m).catch(() => {});
    };

    let startData: any = null;
    let lastStartErr = '';
    let tried9016 = false;
    let lastSessionId: any = null;

    const shipIdPayload = shipIds.map((id) => {
      const n = Number(id);
      return Number.isFinite(n) && String(n) === String(id) ? n : id;
    });

    for (let t = 1; t <= 3; t++) {
      const resp = await this.post(gameToken, 'pve/start', {
        chapterId,
        listShip: JSON.stringify(shipIdPayload),
      });
      if (resp?.errorCode === 0) {
        startData = resp.data;
        break;
      }

      const code = this.getMsgCode(resp);
      const msg =
        typeof resp?.message === 'object'
          ? resp.message?.msgCode || JSON.stringify(resp.message)
          : resp?.message || `errorCode=${resp?.errorCode}`;
      lastStartErr = `start:${code || msg}`;

      if (code === '9014') {
        const stuckId =
          resp?.data?.PveSession?.id ||
          resp?.data?.id ||
          lastSessionId;
        await note('⚠️ Session ပိတ်နေ — 5s စောင့်မည်');
        await this.closeStuckSession(gameToken, stuckId);
        lastSessionId = null;
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (code === '9016') {
        // ship durability — wait 15s once then skip
        if (!tried9016) {
          tried9016 = true;
          await note('⏳ သင်္ဘော durability — 15s စောင့်မည်');
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        return {
          ok: false,
          error: 'သင်္ဘော durability မလောက် — level ကျော်မည် (9016)',
        };
      }

      if (code === '9005') {
        return {
          ok: false,
          error: 'Energy ကုန်သွားပြီ (9005)',
          fatal: true,
        };
      }

      await note(`⚠️ Level မစနိုင် — retry ${t}/3 (${code || msg})`);
      if (t < 3) await new Promise((r) => setTimeout(r, 5000));
    }

    if (!startData) {
      return { ok: false, error: lastStartErr || 'pve/start failed' };
    }

    const session = startData.PveSession || startData.pveSession || {};
    const sessionId = session.id || startData.matchId || startData.id;
    if (!sessionId) return { ok: false, error: 'sessionId မရပါ' };
    lastSessionId = sessionId;

    const yourShips = startData.yourShips || session.yourShips || [];
    const shipCount = yourShips.length || shipIds.length || 3;
    const listShipHp = Array(shipCount).fill(100);

    await new Promise((r) => setTimeout(r, 3000));

    let lastUpdateErr = '';
    for (let poll = 1; poll <= 30; poll++) {
      const r = await this.post(gameToken, 'pve/update-result', {
        matchId: sessionId,
        result: 'Win',
        listShipHp: JSON.stringify(listShipHp),
        star: 3,
        timestamp: new Date().toUTCString(),
      });
      if (r?.errorCode === 0) {
        return { ok: true, data: r.data };
      }
      const code = this.getMsgCode(r);
      const msg =
        typeof r?.message === 'object'
          ? r.message?.msgCode || JSON.stringify(r.message)
          : r?.message || `errorCode=${r?.errorCode}`;
      lastUpdateErr = `update:${code || msg}`;

      if (code === '9000') {
        await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      break;
    }

    // failed update — close as Lose so next level can start
    await this.closeStuckSession(gameToken, sessionId);
    return { ok: false, error: lastUpdateErr || 'update-result failed' };
  }

  /** Auto battle levels 1→N (default 10 for telegram speed; can be higher) */
  static async autoBattle(
    gameToken: string,
    maxLevels = 15,
    onLog?: (msg: string) => Promise<void>,
    shouldStop?: () => boolean
  ): Promise<{ win: number; fail: number; logs: string[]; stopped: boolean }> {
    const logs: string[] = [];
    const log = async (m: string) => {
      logs.push(m);
      if (onLog) await onLog(m).catch(() => {});
    };

    const lineup = await this.getLineup(gameToken);
    if (!lineup.ok) {
      await log(`❌ ${lineup.message}`);
      return { win: 0, fail: 0, logs, stopped: false };
    }
    await log(`✅ Ships: ${lineup.shipIds.length}`);

    const mapResp = await this.post(gameToken, 'pve/map-chapters', { mapId: 1 });
    if (mapResp?.errorCode !== 0) {
      await log('❌ Chapter စာရင်း မရပါ');
      return { win: 0, fail: 0, logs, stopped: false };
    }
    const chapters = (mapResp.data?.chapters || [])
      .filter((c: any) => c.index >= 1 && c.index <= maxLevels)
      .sort((a: any, b: any) => a.index - b.index);

    let win = 0;
    let fail = 0;
    let stopped = false;
    for (const ch of chapters) {
      if (shouldStop && shouldStop()) {
        stopped = true;
        await log('🛑 User က ရပ်လိုက်ပါသည်');
        break;
      }
      const energyCost = ch.energyConsumed || 5;
      await log(`⚔️ ${ch.name || 'Level ' + ch.index} (⚡-${energyCost})`);
      const result = await this.pveChapter(
        gameToken,
        ch.id,
        lineup.shipIds,
        log
      );
      if (result.ok) {
        win++;
        const island = result.data?.island || {};
        await log(
          `✅ WIN ★${result.data?.star || 3} | ⚡${island.energy ?? '?'} 💰${this.fmt(island.PVG || 0)}`
        );
      } else {
        fail++;
        await log(`❌ Fail: ${result.error}`);
        if (result.fatal) {
          await log('⛔ Energy ကုန် — ရပ်မည်');
          break;
        }
        // 9016 skip level and continue; other errors continue too
      }
              if (shouldStop && shouldStop()) {
          stopped = true;
          await log('🛑 User က ရပ်လိုက်ပါသည်');
          break;
        }

        await new Promise((r) => setTimeout(r, 1200));
      }   // ← else ပိတ်
    }     // ← for ပိတ်

    await log(
      stopped
        ? `${pe(PE.notification, '🛑')} ` +
          `ရပ်လိုက်ပါပြီ: ${win} win / ${fail} fail`
        : `${pe(PE.check, '🏁')} ` +
          `Done: ${win} win / ${fail} fail`
    );

    return { win, fail, logs, stopped };
  }     // ← autoBattle ပိတ်

  static async spin(gameToken: string, spinType = 1): Promise<{ ok: boolean; message: string }> {
    const resp = await this.post(gameToken, 'lucky-shot/spin', { spinType });
    if (resp?.errorCode === 0) {
      const d = resp.data || {};
      const wheel = d.wheel || {};
      const name = wheel.MBValue || wheel.name || 'Prize';
      return { ok: true, message: `🎰 ${name} x${wheel.quantity || 1}` };
    }
    const code = this.getMsgCode(resp);
    if (code === '9005') return { ok: false, message: 'Gold/Diamond မလောက်ပါ' };
    if (code === '9016') return { ok: false, message: 'ဒီနေ့ Spin ကန့်သတ် ပြည့်ပြီ' };
    return { ok: false, message: String(resp?.message || 'Spin မရပါ') };
  }

  static async exchangeList(gameToken: string): Promise<{
    ok: boolean;
    packs: any[];
    stones: number;
    message?: string;
  }> {
    const resp = await this.post(gameToken, 'exchange-reward/list', {});
    if (resp?.errorCode !== 0) return { ok: false, packs: [], stones: 0, message: 'List မရပါ' };
    const d = resp.data || {};
    const isSub = d.subStatus?.status === true;
    const packs = [...(isSub ? d.subUserExchange || [] : []), ...(d.freeUserExchange || [])];
    return { ok: true, packs, stones: d.energyStone || 0 };
  }

  static async doExchange(gameToken: string, pack: any): Promise<{ ok: boolean; message: string }> {
    const isSub = !!pack.dataCode;
    const endpoint = isSub ? 'exchange-reward/exchange-sub' : 'exchange-reward/exchange-free';
    const resp = await this.post(gameToken, endpoint, { packId: pack.id });
    if (resp?.errorCode === 0) {
      const stoneNow = resp.data?.energyStone ?? '?';
      return { ok: true, message: `✅ Exchange success! Stones: ${stoneNow}` };
    }
    const code = this.getMsgCode(resp);
    if (code === '9005') return { ok: false, message: 'Gold/Stone မလောက်ပါ' };
    if (code === '9006') return { ok: false, message: 'Item သုံးပြီးသား' };
    return { ok: false, message: String(resp?.message || 'Exchange မရပါ') };
  }

  static async buyEnergy(gameToken: string): Promise<{ ok: boolean; message: string }> {
    const resp = await this.post(gameToken, 'island/buy-energy', {});
    if (resp?.errorCode === 0) {
      const island = resp.data?.island || {};
      return {
        ok: true,
        message: `✅ Energy: ${island.energy ?? '?'} | Diamond: ${this.fmt(island.PVF || 0)}`,
      };
    }
    const code = this.getMsgCode(resp);
    if (code === '9005' || code === '9006') return { ok: false, message: 'Diamond မလောက်ပါ' };
    if (code === '9032') return { ok: false, message: 'ဒီနေ့ Energy ဝယ်ကန့်သတ် ပြည့်ပြီ' };
    return { ok: false, message: String(resp?.message || 'Buy energy မရပါ') };
  }
}

/**
 * MyID session ရှိပြီးသား → Pirate War game token အလိုအလျောက် ယူသည်
 * သီးသန့် Pirate login မလိုအပ်ပါ
 */
async function ensurePirateSession(
  tgUserId: number,
  myIdSess: MyIdSession,
  forceRefresh = false
): Promise<PirateSession | null> {
  const existing = pirateSessions.get(tgUserId);
  // same MyID token already mapped
  if (
    !forceRefresh &&
    existing?.gameToken &&
    existing.mytelJwt === myIdSess.access_token
  ) {
    return existing;
  }

  if (!myIdSess.access_token) return null;

  const login = await PirateWarService.login(myIdSess.access_token);
  if (!login.ok || !login.gameToken) {
    console.error('Pirate auto-connect failed:', login.message);
    return null;
  }

  const sess: PirateSession = {
    gameToken: login.gameToken,
    mytelJwt: myIdSess.access_token,
    phone: myIdSess.phone,
  };
  pirateSessions.set(tgUserId, sess);
  return sess;
}


export const bot = new Telegraf<any>(BOT_TOKEN, {
  // OU Game playRound can take several minutes (8–20s per slot × 5 slots × up to 5 rounds)
  handlerTimeout: 10 * 60 * 1000, // 10 minutes
});
console.log('✅ Bot token loaded (...' + BOT_TOKEN.slice(-6) + ')');

// ==========================================
// 📢 CHANNEL FORCE-JOIN (REAL WORKING)
// ==========================================
const CHANNELS_FILE = path.join(process.cwd(), 'channels.json');

async function loadChannels(): Promise<string[]> {
  try {
    const data = await fs.readFile(CHANNELS_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed.channels) ? parsed.channels : [];
  } catch {
    return []; // empty = no force join required
  }
}

async function saveChannels(channels: string[]) {
  await fs.writeFile(CHANNELS_FILE, JSON.stringify({ channels }, null, 2));
}

async function checkAllChannelsMembership(userId: number): Promise<{ ok: boolean; missing: string[] }> {
  const channels = await loadChannels();
  if (!channels.length) return { ok: true, missing: [] };

  const missing: string[] = [];
  for (const channel of channels) {
    try {
      const member = await bot.telegram.getChatMember(channel, userId);
      const status = String(member.status).toLowerCase();
      if (status === 'left' || status === 'kicked') {
        missing.push(channel);
      }
    } catch (e: any) {
      // Bot must be admin in the channel. If check fails we treat as not joined.
      console.warn(`[Channel] check failed for ${channel}:`, e.message);
      missing.push(channel);
    }
  }
  return { ok: missing.length === 0, missing };
}

async function showJoinChannelsPrompt(ctx: any, missing: string[]) {
  let text =
    `${pe(PE.forceJoin, '⚠️')} <b>JOIN REQUIRED</b>\n` +
    `════════════════════\n` +
    `Bot သုံးရန် အောက်ပါ channel များကို join ပေးပါ:\n\n`;

  const buttons: any[][] = [];
  for (const ch of missing) {
    const username = ch.replace('@', '');
    text += `${pe(PE.forceJoin, '📢')} <b>${ch}</b>\n`;
    buttons.push([{
      text: `JOIN ${ch}`,
      url: `https://t.me/${username}`,
      style: 'primary',
      icon_custom_emoji_id: PE.forceJoin,
    }]);
  }
  text += `\n${pe(PE.check, '✅')} Join ပြီးရင် Check ကိုနှိပ်ပါ`;

  buttons.push([{
    text: "I've Joined - Check",
    callback_data: 'check_join',
    style: 'success',
    icon_custom_emoji_id: PE.check,
  }]);

  const extra = { parse_mode: 'HTML' as const, reply_markup: { inline_keyboard: buttons } };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, extra).catch(() => ctx.reply(text, extra));
  } else {
    await ctx.reply(text, extra);
  }
}

/** Returns true if user is allowed to continue */
async function enforceChannelJoin(ctx: any): Promise<boolean> {
  if (!ctx.from) return false;
  if (isAdmin(ctx)) return true;

  const { ok, missing } = await checkAllChannelsMembership(ctx.from.id);
  if (!ok) {
    await showJoinChannelsPrompt(ctx, missing);
    return false;
  }
  return true;
}

// ==========================================
// 🛠️ ADMIN PANEL (ABSOLUTE TOP LEVEL PRIORITY)
// ==========================================

function getAdminId() {
  return process.env.ADMIN_USER_ID || '7308292609';
}

function isAdmin(ctx: any) {
  const adminId = getAdminId();
  return adminId && ctx.from?.id?.toString() === adminId.toString();
}

bot.command('admin', async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  
  // Force leave scene if they are in one (to prevent scene eating future messages)
  if (ctx.scene) await ctx.scene.leave().catch(()=>{});
  
  await renderAdminDashboard(ctx);
});

bot.command('find', async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  if (ctx.scene) await ctx.scene.leave().catch(()=>{});

  const match = ctx.message.text.match(/^\/find\s+(.+)$/);
  if (!match) {
    return ctx.reply('အသုံးပြုပုံ: <code>/find @username</code> (သို့) <code>/find userid</code>', { parse_mode: 'HTML' });
  }

  const query = match[1].trim().replace('@', '').toLowerCase();
  const db = await getDb();
  const usersArray = Object.entries(db.users || {}).map(([id, u]: any) => ({ id, ...u }));
  
  const foundUser = usersArray.find(u => 
    u.id.toString() === query || 
    (u.username && u.username.toLowerCase() === query)
  );

  if (foundUser) {
    await renderUserProfile(ctx, foundUser.id, 0);
  } else {
    await ctx.reply(`❌ <b>${query}</b> အမည်ဖြင့် User ကို ရှာမတွေ့ပါ။`, { parse_mode: 'HTML' });
  }
});

/**
 * Broadcast state (in-memory).
 * Using copyMessage so Photo + Premium/Custom Emoji entities are preserved exactly
 * as the admin (Premium user) sent them.
 */
const broadcastPending = new Map<number, {
  mode: 'awaiting_content' | 'awaiting_confirm';
  fromChatId?: number;
  messageId?: number;
}>();

async function doBroadcastCopy(
  fromChatId: number,
  messageId: number,
  progressCb?: (text: string) => Promise<void>
): Promise<{ success: number; fail: number }> {
  const db = await getDb();
  const users = Object.keys(db.users || {});
  let successCount = 0;
  let failCount = 0;
  const total = users.filter((id) => !(db.users[id] && db.users[id].banned)).length;
  let done = 0;

  for (const userId of users) {
    if (db.users[userId] && db.users[userId].banned) continue;
    try {
      // copyMessage preserves media + custom_emoji entities (Premium Emoji)
      await bot.telegram.copyMessage(userId, fromChatId, messageId);
      successCount++;
    } catch {
      failCount++;
    }
    done++;
    if (progressCb && done % 25 === 0) {
      await progressCb(`⏳ ပို့နေသည်... ${done}/${total}`).catch(() => {});
    }
    // small delay to avoid flood limits
    if (done % 20 === 0) await new Promise((r) => setTimeout(r, 300));
  }
  return { success: successCount, fail: failCount };
}

bot.command('broadcast', async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  if (ctx.scene) await ctx.scene.leave().catch(() => {});

  const match = ctx.message && 'text' in ctx.message
    ? ctx.message.text.match(/^\/broadcast(?:\s+([\s\S]+))?$/)
    : null;

  // Quick text-only: /broadcast Hello world
  if (match && match[1] && match[1].trim()) {
    const message = match[1].trim();
    const db = await getDb();
    const users = Object.keys(db.users || {});
    let successCount = 0;
    let failCount = 0;
    const sendingMsg = await ctx.reply('⏳ ပေးပို့နေပါသည်... ခဏစောင့်ပါ။');
    for (const userId of users) {
      if (db.users[userId] && db.users[userId].banned) continue;
      try {
        await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML' });
        successCount++;
      } catch {
        failCount++;
      }
    }
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      sendingMsg.message_id,
      undefined,
      `✅ Broadcast ပြီးဆုံးပါပြီ။\n\nအောင်မြင်: ${successCount} ယောက်\nမအောင်မြင်: ${failCount} ယောက်`
    ).catch(() => {});
    return;
  }

  // Interactive mode: photo + caption + Premium Emoji
  broadcastPending.set(ctx.from!.id, { mode: 'awaiting_content' });
  await ctx.reply(
    `📢 <b>Broadcast Mode</b>\n` +
    `════════════════════\n\n` +
    `ပုံ / ဗီဒီယို / စာ / Sticker အားလုံး ပို့နိုင်ပါတယ်။\n` +
    `<b>Premium Emoji</b> ပါသော caption ကိုလည်း ပို့နိုင်ပါတယ်။\n\n` +
    `1️⃣ အောက်မှာ ပို့ချင်တဲ့ message ကို ပို့ပါ\n` +
    `2️⃣ Confirm နှိပ်ရင် User အားလုံးဆီ <b>အတိအကျ</b> ရောက်ပါမယ်\n\n` +
    `<i>/cancel နှိပ်ရင် ပယ်ဖျက်နိုင်ပါတယ်</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'adm_bc_cancel' }]],
      },
    }
  );
});

bot.command('addchannel', async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  const match = ctx.message.text.match(/^\/addchannel\s+(@?\w+)/);
  if (!match) {
    return ctx.reply('အသုံးပြုပုံ: <code>/addchannel @channelusername</code>', { parse_mode: 'HTML' });
  }
  let ch = match[1];
  if (!ch.startsWith('@')) ch = '@' + ch;
  const channels = await loadChannels();
  if (channels.includes(ch)) {
    return ctx.reply(`ℹ️ ${ch} ရှိပြီးသားပါ။`);
  }
  channels.push(ch);
  await saveChannels(channels);
  await ctx.reply(
    `✅ ${ch} ထည့်ပြီးပါပြီ။\n\n⚠️ Bot ကို ဒီ channel ထဲမှာ <b>Admin</b> အဖြစ် ထည့်ပေးပါ (မထည့်ရင် membership check မအလုပ်လုပ်ပါ)။`,
    { parse_mode: 'HTML' }
  );
});

bot.command('removechannel', async (ctx, next) => {
  if (!isAdmin(ctx)) return next();
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  const match = ctx.message.text.match(/^\/removechannel\s+(@?\w+)/);
  if (!match) {
    return ctx.reply('အသုံးပြုပုံ: <code>/removechannel @channelusername</code>', { parse_mode: 'HTML' });
  }
  let ch = match[1];
  if (!ch.startsWith('@')) ch = '@' + ch;
  const channels = await loadChannels();
  const idx = channels.indexOf(ch);
  if (idx === -1) {
    return ctx.reply(`ℹ️ ${ch} မရှိပါ။`);
  }
  channels.splice(idx, 1);
  await saveChannels(channels);
  await ctx.reply(`✅ ${ch} ဖယ်ရှားပြီးပါပြီ။`);
});

// INTERCEPT ALL CALLBACKS FOR ADMIN
bot.on('callback_query', async (ctx, next) => {
  const cbQuery = ctx.callbackQuery as any;
  if (!cbQuery || !cbQuery.data) return next();
  
  const data = cbQuery.data as string;
  
  if (data.startsWith('adm_')) {
    if (!isAdmin(ctx)) {
      return ctx.answerCbQuery('⚠️ Unauthorized', { show_alert: true }).catch(()=>{});
    }

    try {
      await ctx.answerCbQuery().catch(()=>{});

      if (data === 'adm_main') {
        broadcastPending.delete(ctx.from!.id);
        await renderAdminDashboard(ctx).catch(e => ctx.reply("Error: " + (e as Error).message));
      } 
      else if (data.startsWith('adm_pg_')) {
        const page = parseInt(data.replace('adm_pg_', ''), 10);
        await renderUsersPage(ctx, page).catch(e => ctx.reply("Page Error: " + (e as Error).message));
      } 
      else if (data.startsWith('adm_u_')) {
        const parts = data.split('_');
        const userId = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        await renderUserProfile(ctx, userId, page).catch(e => ctx.reply("User Error: " + (e as Error).message));
      } 
      else if (data.startsWith('adm_b_')) {
        const parts = data.split('_');
        const userId = parts[2];
        const page = parseInt(parts[3], 10) || 0;
        
        if (userId === getAdminId().toString()) {
           await ctx.answerCbQuery('⚠️ Admin ကို Ban မရပါ', { show_alert: true }).catch(() => {});
        } else {
          const db = await getDb();
          if (db.users && db.users[userId]) {
            db.users[userId].banned = !db.users[userId].banned;
            await saveDb(db);
            await renderUserProfile(ctx, userId, page).catch(e => ctx.reply("Ban Error: " + (e as Error).message));
          }
        }
      } 
      else if (data === 'adm_s') {
        let msg = `🔍 <b>Search User</b>\n\n`;
        msg += `အသုံးပြုသူကို ရှာဖွေရန် အောက်ပါအတိုင်း စာရိုက်ထည့်ပါ:\n\n`;
        msg += `👉 <code>/find @username</code> (Username ဖြင့်ရှာရန်)\n`;
        msg += `👉 <code>/find 123456789</code> (User ID ဖြင့်ရှာရန်)\n\n`;
        msg += `<i>ဥပမာ - /find @nytheris</i>`;

        await ctx.editMessageText(msg, { 
          parse_mode: 'HTML', 
          reply_markup: { inline_keyboard: [[{ text: '« Back to Dashboard', callback_data: 'adm_main' }]] } 
        }).catch(e => ctx.reply("Search Error: " + (e as Error).message));
      } 
      else if (data === 'adm_bc') {
        broadcastPending.set(ctx.from!.id, { mode: 'awaiting_content' });
        const msg =
          `📢 <b>Broadcast Mode</b>\n` +
          `════════════════════\n\n` +
          `ပုံ / ဗီဒီယို / စာ / Sticker အားလုံး ပို့နိုင်ပါတယ်။\n` +
          `<b>Premium Emoji</b> ပါ caption လည်း ရပါတယ်။\n\n` +
          `1️⃣ အောက်မှာ ပို့ချင်တဲ့ message ကို ပို့ပါ\n` +
          `2️⃣ Confirm နှိပ်ရင် User အားလုံးဆီ <b>အတိအကျ</b> (emoji + ပုံ) ရောက်ပါမယ်\n\n` +
          `Quick text: <code>/broadcast သင်ပို့လိုသောစာ</code>\n\n` +
          `<i>/cancel နှိပ်ရင် ပယ်ဖျက်နိုင်ပါတယ်</i>`;
        await ctx.editMessageText(msg, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Cancel', callback_data: 'adm_bc_cancel' }],
              [{ text: '« Back to Dashboard', callback_data: 'adm_main' }],
            ],
          },
        }).catch((e) => ctx.reply('BC Error: ' + (e as Error).message));
      }
      else if (data === 'adm_bc_cancel') {
        broadcastPending.delete(ctx.from!.id);
        await ctx.editMessageText('❌ Broadcast ပယ်ဖျက်လိုက်ပါပြီ။', {
          reply_markup: { inline_keyboard: [[{ text: '« Back to Dashboard', callback_data: 'adm_main' }]] },
        }).catch(() => {});
      }
      else if (data === 'adm_bc_confirm') {
        const pending = broadcastPending.get(ctx.from!.id);
        if (!pending || pending.mode !== 'awaiting_confirm' || !pending.fromChatId || !pending.messageId) {
          broadcastPending.delete(ctx.from!.id);
          await ctx.editMessageText('❌ Broadcast session မရှိတော့ပါ။ ပြန်စပါ။', {
            reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: 'adm_bc' }]] },
          }).catch(() => {});
          return;
        }

        await ctx.editMessageText('⏳ User အားလုံးဆီ ပို့နေပါသည်... ခဏစောင့်ပါ။').catch(() => {});
        const progressMsg = ctx.callbackQuery.message as any;
        const { success, fail } = await doBroadcastCopy(
          pending.fromChatId,
          pending.messageId,
          async (text) => {
            if (progressMsg?.message_id) {
              await ctx.telegram.editMessageText(ctx.chat!.id, progressMsg.message_id, undefined, text).catch(() => {});
            }
          }
        );
        broadcastPending.delete(ctx.from!.id);
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          progressMsg.message_id,
          undefined,
          `✅ <b>Broadcast ပြီးဆုံးပါပြီ</b>\n\n` +
            `အောင်မြင်: <b>${success}</b> ယောက်\n` +
            `မအောင်မြင်: <b>${fail}</b> ယောက်\n\n` +
            `<i>Premium Emoji + ပုံ အတိအကျ copy လုပ်ပို့ထားပါတယ်။</i>`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '« Back to Dashboard', callback_data: 'adm_main' }]] },
          }
        ).catch(() => {});
      }
      else if (data === 'adm_channels') {
        const channels = await loadChannels();
        let msg = `📢 <b>Force-Join Channels</b>\n\n`;
        if (!channels.length) {
          msg += `<i>Channel မရှိသေးပါ (force-join ပိတ်ထားသည်)</i>\n\n`;
        } else {
          channels.forEach((c, i) => { msg += `${i + 1}. <code>${c}</code>\n`; });
          msg += `\n`;
        }
        msg += `➕ ထည့်ရန်: <code>/addchannel @channelusername</code>\n`;
        msg += `➖ ဖယ်ရန်: <code>/removechannel @channelusername</code>\n\n`;
        msg += `⚠️ Bot ကို channel ထဲမှာ <b>Admin</b> အဖြစ် ထည့်ပေးရပါမယ် (getChatMember အလုပ်လုပ်ဖို့)။`;
        await ctx.editMessageText(msg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '« Back to Dashboard', callback_data: 'adm_main' }]] }
        }).catch(e => ctx.reply("Channels Error: " + (e as Error).message));
      }
    } catch (err: any) {
      console.error("Admin Router Error:", err);
      await ctx.reply("Router Error: " + err.message).catch(()=>{});
    }
    return; // DO NOT CALL next() FOR ADMIN EVENTS
  }
  
  return next(); // PASSTHROUGH NON-ADMIN EVENTS
});

/**
 * When admin is in Broadcast mode, capture ANY message (photo/text/video/...)
 * and ask for confirmation. copyMessage later preserves Premium Emoji + media.
 */
bot.on('message', async (ctx, next) => {
  if (!ctx.from || !isAdmin(ctx)) return next();

  const pending = broadcastPending.get(ctx.from.id);
  if (!pending || pending.mode !== 'awaiting_content') return next();

  // Ignore commands while waiting for content (except /cancel)
  if (ctx.message && 'text' in ctx.message && ctx.message.text?.startsWith('/')) {
    if (ctx.message.text.startsWith('/cancel')) {
      broadcastPending.delete(ctx.from.id);
      await ctx.reply('❌ Broadcast ပယ်ဖျက်လိုက်ပါပြီ။');
      return;
    }
    return next();
  }

  // Store the message to copy later
  broadcastPending.set(ctx.from.id, {
    mode: 'awaiting_confirm',
    fromChatId: ctx.chat!.id,
    messageId: ctx.message.message_id,
  });

  let previewType = 'စာ';
  if ('photo' in ctx.message && ctx.message.photo) previewType = 'ဓာတ်ပုံ';
  else if ('video' in ctx.message && ctx.message.video) previewType = 'ဗီဒီယို';
  else if ('animation' in ctx.message && ctx.message.animation) previewType = 'GIF';
  else if ('document' in ctx.message && ctx.message.document) previewType = 'ဖိုင်';
  else if ('sticker' in ctx.message && ctx.message.sticker) previewType = 'Sticker';
  else if ('voice' in ctx.message && ctx.message.voice) previewType = 'Voice';
  else if ('video_note' in ctx.message && ctx.message.video_note) previewType = 'Video Note';

  await ctx.reply(
    `✅ <b>Message လက်ခံရရှိပါပြီ</b> (${previewType})\n\n` +
      `Premium Emoji ပါရင် User ဆီမှာလည်း <b>အတူတူ</b> ပေါ်ပါမယ်။\n` +
      `Confirm နှိပ်ရင် အားလုံးဆီ ပို့ပါမယ်။`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm & Send', callback_data: 'adm_bc_confirm' },
            { text: '❌ Cancel', callback_data: 'adm_bc_cancel' },
          ],
          [{ text: '🔄 ပုံ/စာ အသစ်ပို့မယ်', callback_data: 'adm_bc' }],
        ],
      },
    }
  );
  // Do not call next() — this message was for broadcast only
});

async function renderAdminDashboard(ctx: any) {
  try {
    const db = await getDb();
    const totalUsers = Object.keys(db.users || {}).length;
    const activeSessions = Object.keys(db.sessions || {}).length;
    const bannedUsers = Object.values(db.users || {}).filter((u: any) => u.banned).length;
    
    let msg = `🌟 <b>Admin Control Center</b> 🌟\n\n`;
    msg += `👥 <b>Total Users</b>: <code>${totalUsers}</code>\n`;
    msg += `🟢 <b>Active Sessions</b>: <code>${activeSessions}</code>\n`;
    msg += `🔴 <b>Banned Users</b>: <code>${bannedUsers}</code>\n\n`;
    msg += `<i>စနစ်ကို စီမံရန် အောက်ပါ လုပ်ဆောင်ချက်များကို ရွေးချယ်ပါ:</i>`;

    const channels = await loadChannels();
    let msg2 = msg;
    msg2 += `\n📢 <b>Force-Join Channels</b>: <code>${channels.length}</code>`;
    if (channels.length) msg2 += `\n<code>${channels.join(', ')}</code>`;

    const buttons = [
      [{ text: '📋 View All Users', callback_data: 'adm_pg_0' }],
      [{ text: '🔍 Search User', callback_data: 'adm_s' }],
      [{ text: '📢 Broadcast', callback_data: 'adm_bc' }],
      [{ text: '📢 Channels', callback_data: 'adm_channels' }],
      [{ text: '🔄 Refresh', callback_data: 'adm_main' }]
    ];

    msg = msg2;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(e => console.error(e));
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(e => console.error(e));
    }
  } catch (e) {
    console.error("renderAdminDashboard error:", e);
  }
}

async function renderUsersPage(ctx: any, page: number) {
  try {
    const limit = 10; // USE 10 BUTTONS PER PAGE (5 rows of 2) TO AVOID ANY INLINE KEYBOARD LIMITS
    const db = await getDb();
    
    const usersArray = Object.entries(db.users || {})
      .map(([id, u]: any) => ({ id, ...u }))
      .sort((a, b) => new Date(b.last_seen || 0).getTime() - new Date(a.last_seen || 0).getTime());
    
    const totalPages = Math.ceil(usersArray.length / limit) || 1;
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const offset = safePage * limit;
    const usersSlice = usersArray.slice(offset, offset + limit);

    let msg = `📋 <b>All Users (Page ${safePage + 1}/${totalPages})</b>\n`;
    msg += `Total Users: <b>${usersArray.length}</b>\n`;
    msg += `<i>Updated: ${new Date().toLocaleTimeString()}</i>\n\n`;
    
    const inline_keyboard: any[][] = [];
    
    for (let i = 0; i < usersSlice.length; i += 2) {
      const row = [];
      for (let j = 0; j < 2; j++) {
        if (usersSlice[i + j]) {
          const user = usersSlice[i + j];
          const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 15) || 'Unknown';
          const safeName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const statusIcon = user.banned ? '🔴' : '🟢';
          row.push({ 
            text: `${statusIcon} ${safeName}`, 
            callback_data: `adm_u_${user.id}_${safePage}` 
          });
        }
      }
      inline_keyboard.push(row);
    }

    const navRow = [];
    if (safePage > 0) {
      navRow.push({ text: '⬅️ Prev', callback_data: `adm_pg_${safePage - 1}` });
    }
    if (safePage < totalPages - 1) {
      navRow.push({ text: 'Next ➡️', callback_data: `adm_pg_${safePage + 1}` });
    }
    
    if (navRow.length > 0) {
      inline_keyboard.push(navRow);
    }
    
    inline_keyboard.push([{ text: '« Back to Dashboard', callback_data: 'adm_main' }]);

    await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(async (e: any) => {
      console.error("Edit failed:", e);
      await ctx.reply("Telegram API Error: " + e.message).catch(()=>{});
    });
  } catch (e) {
    console.error("renderUsersPage error:", e);
  }
}

async function renderUserProfile(ctx: any, userId: string, fromPage: number = 0) {
  try {
    const db = await getDb();
    const user = db.users?.[userId];
    if (!user) {
      if (ctx.callbackQuery) {
          return ctx.editMessageText('❌ User not found in database!').catch(()=>{});
      }
      return ctx.reply('❌ User not found in database!').catch(() => {});
    }

    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const safeName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeUsername = user.username ? String(user.username).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'N/A';
    const status = user.banned ? '🔴 Banned' : '🟢 Active';

    let msg = `👤 <b>User Profile</b>\n\n`;
    msg += `<b>ID:</b> <code>${userId}</code>\n`;
    msg += `<b>Name:</b> ${safeName}\n`;
    msg += `<b>Username:</b> ${safeUsername !== 'N/A' ? `@${safeUsername}` : 'N/A'}\n`;
    msg += `<b>Status:</b> ${status}\n`;
    msg += `<b>Last Seen:</b> ${user.last_seen ? new Date(user.last_seen).toLocaleString() : 'Unknown'}\n`;
    msg += `<i>Refreshed: ${new Date().toLocaleTimeString()}</i>\n`;

    const actionText = user.banned ? '🟢 Unban User' : '🔴 Ban User';
    
    const inline_keyboard = [
      [{ text: actionText, callback_data: `adm_b_${userId}_${fromPage}` }],
      [{ text: '📋 Back to List', callback_data: `adm_pg_${fromPage}` }],
      [{ text: '« Back to Dashboard', callback_data: 'adm_main' }]
    ];

    if (ctx.callbackQuery) {
      await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(e => console.error(e));
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(e => console.error(e));
    }
  } catch (e) {
    console.error("renderUserProfile error:", e);
  }
}

// ==========================================

const DB_PATH_ENV = process.env.DB_PATH || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DB_FILE = DB_PATH_ENV ? path.join(DB_PATH_ENV, 'bot_db.json') : path.join(process.cwd(), 'bot_db.json');

// Helper to generate node checksum
function generateChecksumNode(userId: string | null, body: string): string {
  const keyStr = "b^[VCHDL786mkTp]*" + (userId || "");
  const hmac = crypto.createHmac('sha256', keyStr);
  hmac.update(body);
  return hmac.digest('hex');
}

// Simple JSON DB
let memoryDb: any = null;
let isWritingDb = false;
let writePending = false;

async function getDb() {
  if (memoryDb) return memoryDb;
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    memoryDb = JSON.parse(data);
  } catch (e) {
    memoryDb = { sessions: {}, myidSessions: {}, users: {}, stats: { totalUsers: 0, commandUsage: {} } };
  }
  if (!memoryDb.sessions) memoryDb.sessions = {};
  if (!memoryDb.myidSessions) memoryDb.myidSessions = {};
  if (!memoryDb.users) memoryDb.users = {};
  if (!memoryDb.stats) memoryDb.stats = { totalUsers: 0, commandUsage: {} };
  return memoryDb;
}

async function saveDb(data: any) {
  memoryDb = data;
  if (isWritingDb) {
    writePending = true;
    return;
  }
  isWritingDb = true;
  writePending = false;
  try {
    if (DB_PATH_ENV) {
      await fs.mkdir(DB_PATH_ENV, { recursive: true }).catch(() => {});
    }
    await fs.writeFile(DB_FILE, JSON.stringify(memoryDb, null, 2));
  } catch (e) {
    console.error("DB write error", e);
  } finally {
    isWritingDb = false;
    if (writePending) {
      saveDb(memoryDb);
    }
  }
}

async function getSession(tgUserId: number) {
  const db = await getDb();
  return db.sessions[tgUserId.toString()];
}

async function saveSession(tgUserId: number, sessionData: any) {
  const db = await getDb();
  db.sessions[tgUserId.toString()] = sessionData;
  await saveDb(db);
}

async function clearSession(tgUserId: number) {
  const db = await getDb();
  delete db.sessions[tgUserId.toString()];
  await saveDb(db);
}

// ---------- MYTEL / MyID sessions (independent of ATOM) ----------
async function getMyIdSession(tgUserId: number): Promise<MyIdSession | null> {
  const db = await getDb();
  return db.myidSessions?.[tgUserId.toString()] || null;
}

async function saveMyIdSession(tgUserId: number, data: MyIdSession) {
  const db = await getDb();
  if (!db.myidSessions) db.myidSessions = {};
  db.myidSessions[tgUserId.toString()] = data;
  await saveDb(db);
}

async function clearMyIdSession(tgUserId: number) {
  const db = await getDb();
  if (db.myidSessions) {
    delete db.myidSessions[tgUserId.toString()];
    await saveDb(db);
  }
  try {
    pirateSessions.delete(tgUserId);
  } catch {}
}

async function recordUser(from: any) {
  if (!from) return;
  const db = await getDb();
  const idStr = from.id.toString();
  if (!db.users) db.users = {};
  
  const existing = db.users[idStr] || {};
  db.users[idStr] = {
    ...existing,
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
    is_bot: from.is_bot,
    last_seen: new Date().toISOString()
  };
  await saveDb(db);
}

async function isUserBanned(tgUserId: number): Promise<boolean> {
  const adminId = process.env.ADMIN_USER_ID || '8797803204';
  if (adminId && tgUserId.toString() === adminId.toString()) {
    return false;
  }
  const db = await getDb();
  if (!db.users) return false;
  const user = db.users[tgUserId.toString()];
  return user ? !!user.banned : false;
}

async function recordCommand(commandName: string) {
  const db = await getDb();
  if (!db.stats) db.stats = { totalUsers: 0, commandUsage: {} };
  
  // Refresh total users dynamically
  db.stats.totalUsers = Object.keys(db.sessions || {}).length;
  
  if (!db.stats.commandUsage[commandName]) {
    db.stats.commandUsage[commandName] = 1;
  } else {
    db.stats.commandUsage[commandName]++;
  }
  
  await saveDb(db);
}

const gameCooldowns = new Map<number, number>();

function checkGameCooldown(userId: number): number {
  const lastPlayed = gameCooldowns.get(userId);
  if (!lastPlayed) return 0;
  const diff = Date.now() - lastPlayed;
  if (diff < 5000) {
    return Math.ceil((5000 - diff) / 1000);
  }
  return 0;
}

async function handleCooldownCountdown(ctx: any, userId: number): Promise<void> {
  let waitTime = checkGameCooldown(userId);
  if (waitTime <= 0) return;
  const cdMsg = await ctx.reply(`⏳ ${waitTime}`);
  while (waitTime > 0) {
    await new Promise(r => setTimeout(r, 1000));
    waitTime--;
    if (waitTime > 0) {
      await ctx.telegram.editMessageText(ctx.chat.id, cdMsg.message_id, undefined, `⏳ ${waitTime}`).catch(()=>{});
    }
  }
  await ctx.telegram.deleteMessage(ctx.chat.id, cdMsg.message_id).catch(()=>{});
}

function setGameCooldown(userId: number) {
  gameCooldowns.set(userId, Date.now());
}

const COMMON_HEADERS = {
  "accept": "application/json, text/plain, */*",
  "user-agent": "MyTM/4.13.0/Android/30",
  "device-name": "Xiaomi 2201122C", "X-Client-Channel": "Android",
  "x-server-select": "production"
};

const botHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000
});

async function atomApiPost(endpoint: string, data: any, headers: any = {}, retries = 3) {
  const url = `https://store.atom.com.mm${endpoint}`;
  for (let i = 0; i < retries; i++) {
    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      const res = await axios({
        httpsAgent: botHttpsAgent,
        method: "POST",
        url: url,
        data: payload,
        headers: { ...COMMON_HEADERS, "Content-Type": "application/json", ...headers },
        validateStatus: () => true,
        timeout: 10000
      });
      return res.data;
    } catch (e: any) {
      if (i === retries - 1) {
        console.error("atomApiPost error:", e.response?.data || e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

async function atomApiGet(endpoint: string, headers: any = {}, retries = 3) {
  const url = `https://store.atom.com.mm${endpoint}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios({
        httpsAgent: botHttpsAgent,
        method: "GET",
        url: url,
        headers: { ...COMMON_HEADERS, ...headers },
        validateStatus: () => true,
        timeout: 10000
      });
      return res.data;
    } catch (e: any) {
      if (i === retries - 1) {
        console.error("atomApiGet error:", e.response?.data || e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

function isTokenExpired(res: any): boolean {
  if (!res) return false;
  if (res === 401 || res.status === 401 || res.statusCode === 401) return true;
  if (res.response && res.response.status === 401) return true;
  
  if (typeof res === 'string') {
     const str = res.toLowerCase();
     return str.includes('unauthenticated') || str.includes('unauthorized') || str.includes('token expired') || str.includes('invalid token') || str.includes('9001');
  }

  const errCode = String(res.errors?.message?.code || res.errors?.code || res.statusCode || "");
  const errTitle = String(res.errors?.message?.title || res.errors?.title || "").toLowerCase();
  const errMsg = String(res.errors?.message?.message || res.message || res.errors?.message || "").toLowerCase();
     
  if (errCode === "9001" || errCode === "401") return true;
  if (errTitle.includes('unauthenticated') || errTitle.includes('unauthorized') || errTitle.includes('invalid token') || errTitle.includes('token expired')) return true;
  if (errMsg.includes('unauthenticated') || errMsg.includes('unauthorized') || errMsg.includes('invalid token') || errMsg.includes('token expired') || errMsg.includes('9001')) return true;

  return false;
}

async function performTokenRefresh(tgUserId: number, sess: any): Promise<any> {
    const endpoints = [
      `/mytmapi/v1/my/local-auth/refresh-token?msisdn=${sess.msisdn}&userid=${sess.userId || -1}&v=4.16.0`,
      `/mytmapi/v1/my/auth/refresh-token?msisdn=${sess.msisdn}&userid=${sess.userId || -1}&v=4.16.0`,
      `/mytmapi/v1/my/local-auth/refresh-token?msisdn=${sess.msisdn}&userid=-1&v=4.16.0`
    ];
    
    for (const url of endpoints) {
        let res = await atomApiPost(url, { refresh_token: sess.refreshToken }, {}, 1);
        if (!res || res.status !== 'success') {
           res = await atomApiPost(url, { refreshToken: sess.refreshToken }, {}, 1);
        }
        if (res && res.status === 'success' && res.data?.attribute) {
            const payload = res.data.attribute;
            const newSess = {
              token: payload.token || sess.token,
              msisdn: payload.msisdn || sess.msisdn,
              userId: payload.user_id || sess.userId,
              refreshToken: payload.refresh_token || sess.refreshToken
            };
            await saveSession(tgUserId, newSess);
            return newSess;
        }
    }
    return null;
}

async function authApiGet(tgUserId: number, endpoint: string, customHeaders: any = {}) {
  let sess = await getSession(tgUserId);
  if (!sess) return null;
  
  let headers = { "Authorization": `Bearer ${sess.token}`, ...customHeaders };
  let res = await atomApiGet(endpoint, headers);
  
  if (res && res.status !== 'success' && isTokenExpired(res)) {
     const newSess = await performTokenRefresh(tgUserId, sess);
     if (newSess) {
       headers["Authorization"] = `Bearer ${newSess.token}`;
       res = await atomApiGet(endpoint, headers);
     } else {
       if (!res) res = {};
       res._authFailed = true;
     }
  }
  return res || null;
}

async function authApiPost(tgUserId: number, endpoint: string, bodyObj: any, customHeaders: any = {}) {
  let sess = await getSession(tgUserId);
  if (!sess) return null;
  
  const rawBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  let checksum = generateChecksumNode(sess.userId.toString().trim(), rawBody);
  
  let headers = {
    "Authorization": `Bearer ${sess.token}`,
    "Checksum": checksum,
    "X-Atom-Signature": checksum,
    "X-Signature": checksum,
    ...customHeaders
  };
  
  let res = await atomApiPost(endpoint, bodyObj, headers);
  
  if (res && res.status !== 'success' && isTokenExpired(res)) {
     const newSess = await performTokenRefresh(tgUserId, sess);
     if (newSess) {
       let newChecksum = generateChecksumNode(newSess.userId.toString().trim(), rawBody);
       headers["Authorization"] = `Bearer ${newSess.token}`;
       headers["Checksum"] = newChecksum;
       headers["X-Atom-Signature"] = newChecksum;
       headers["X-Signature"] = newChecksum;
       res = await atomApiPost(endpoint, bodyObj, headers);
     } else {
       if (!res) res = {};
       res._authFailed = true;
     }
  }
  return res || null;
}

const isMenuCommand = (text: string) => {
  if (!text) return false;
  if (text.startsWith('/')) return true;
  const keywords = ['အကောင့်', 'လက်ကျန်', 'ပွိုင့်', 'tohtoh', 'ရွှေလယ်တော', 'point', 'claim'];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
};

const authWizard = new Scenes.WizardScene<any>(
  'AUTH_WIZARD',

  // =========================
  // STEP 1 — PHONE NUMBER
  // =========================
  async (ctx) => {
    try {
      await ctx.reply(
        `${pe(PE.atom, '📲')} <b>ဖုန်းနံပါတ်လေး ရိုက်ထည့်ပေးပါဗျ။</b>\n\n` +
        `${pe(PE.notification, '📱')} ဥပမာ - <code>097xxxxxxx</code>\n\n` +
        `${pe(PE.check, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
        {
          parse_mode: 'HTML',
        }
      );

      return ctx.wizard.next();
    } catch (error) {
      console.error('AUTH_WIZARD Step 1 Error:', error);
      return ctx.scene.leave();
    }
  },

  // =========================
  // STEP 2 — SEND OTP
  // =========================
  async (ctx) => {
    try {
      if (ctx.callbackQuery) {
        await ctx
          .answerCbQuery(
            'လုပ်ဆောင်ချက်ကို ဆက်လုပ်ပါ သို့မဟုတ် /cancel ကိုနှိပ်ပါ။'
          )
          .catch(() => {});
        return;
      }

      if (!ctx.message || !('text' in ctx.message)) {
        return;
      }

      const text = String(ctx.message.text).trim();

      // Cancel
      if (text.toLowerCase() === '/cancel') {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>အကောင့်ဝင်ခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Menu button
      if (isMenuCommand(text)) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>လုပ်ဆောင်ချက်ကို ရပ်စဲလိုက်ပါသည်။</b>\n` +
          `ကျေးဇူးပြု၍ ခလုတ်ကို ပြန်နှိပ်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Normalize phone
      let phone = text.replace(/\D/g, '');

      if (phone.startsWith('95')) {
        phone = phone.slice(2);
      }

      if (phone.startsWith('09')) {
        phone = phone.slice(1);
      }

      // Validate phone
      if (phone.length < 7 || phone.length > 10) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>ဖုန်းနံပါတ် မှားယွင်းနေပါတယ်။</b>\n\n` +
          `${pe(PE.notification, '📱')} ဥပမာ - <code>097xxxxxxx</code>\n` +
          `ကျေးဇူးပြု၍ ပြန်လည်စစ်ဆေးပေးပါ။`,
          {
            parse_mode: 'HTML',
          }
        );
      }

      ctx.wizard.state.phone = phone;

      let loadingMsg: any;

      try {
        loadingMsg = await ctx.reply(
          `${pe(PE.loading, '⏳')} <b>OTP ပို့နေပါပြီဗျ...</b>`,
          {
            parse_mode: 'HTML',
          }
        );

        const res = await atomApiPost(
          '/mytmapi/v1/my/local-auth/send-otp?msisdn=&userid=-1&v=4.16.0',
          {
            msisdn: phone,
          }
        );

        await ctx.telegram
          .deleteMessage(ctx.chat.id, loadingMsg.message_id)
          .catch(() => {});

        if (
          res &&
          res.status === 'success' &&
          res.data?.attribute?.code
        ) {
          ctx.wizard.state.otpCode =
            res.data.attribute.code;

          await ctx.reply(
            `${pe(PE.otp, '📨')} <b>OTP ပို့လိုက်ပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '📱')} <b>+95${phone}</b> ကို OTP ပို့ထားပါတယ်။\n\n` +
            `${pe(PE.check, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
            {
              parse_mode: 'HTML',
            }
          );

          return ctx.wizard.next();
        }

        const errMsg =
          res?.errors?.message?.message ||
          res?.message ||
          res?.errors?.title ||
          'ဆာဗာအခက်အခဲကြောင့် OTP ပို့လို့ မရသေးပါဘူး။';

        await ctx.reply(
          `${pe(PE.check, '❌')} <b>${errMsg}</b>`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.scene.leave();
      } catch (error) {
        if (loadingMsg) {
          await ctx.telegram
            .deleteMessage(
              ctx.chat.id,
              loadingMsg.message_id
            )
            .catch(() => {});
        }

        console.error('SEND OTP Error:', error);

        await ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP ပို့နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error('AUTH_WIZARD Step 2 Error:', error);

      await ctx.reply(
        `${pe(PE.check, '❌')} <b>လုပ်ဆောင်နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>`,
        {
          parse_mode: 'HTML',
        }
      ).catch(() => {});

      return ctx.scene.leave();
    }
  },

  // =========================
  // STEP 3 — VERIFY OTP
  // =========================
  async (ctx) => {
    try {
      if (ctx.callbackQuery) {
        await ctx
          .answerCbQuery(
            'လုပ်ဆောင်ချက်ကို ဆက်လုပ်ပါ သို့မဟုတ် /cancel ကိုနှိပ်ပါ။'
          )
          .catch(() => {});
        return;
      }

      if (!ctx.message || !('text' in ctx.message)) {
        return;
      }

      const text = String(ctx.message.text).trim();

      // Cancel
      if (text.toLowerCase() === '/cancel') {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP အတည်ပြုခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Menu button
      if (isMenuCommand(text)) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>လုပ်ဆောင်ချက်ကို ရပ်စဲလိုက်ပါသည်။</b>\n` +
          `ကျေးဇူးပြု၍ ခလုတ်ကို ပြန်နှိပ်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // OTP
      const otp = text.replace(/\D/g, '');

      if (otp.length !== 6) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP ဂဏန်း ၆ လုံး ပြည့်အောင် ရိုက်ထည့်ပေးပါဗျ။</b>\n\n` +
          `${pe(PE.notification, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
          {
            parse_mode: 'HTML',
          }
        );
      }

      const phone = ctx.wizard.state.phone;
      const otpCode = ctx.wizard.state.otpCode;

      if (!phone || !otpCode) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP Session မတွေ့တော့ပါဘူး။</b>\n` +
          `/start ကိုနှိပ်ပြီး ပြန်စမ်းကြည့်ပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      let loadingMsg: any;

      try {
        loadingMsg = await ctx.reply(
          `${pe(PE.loading, '⏳')} <b>OTP မှန်မမှန် စစ်ဆေးနေပါတယ်...</b>`,
          {
            parse_mode: 'HTML',
          }
        );

        const res = await atomApiPost(
          '/mytmapi/v1/my/local-auth/verify-otp?msisdn=&userid=-1&v=4.16.0',
          {
            msisdn: phone,
            code: otpCode,
            otp: otp,
          }
        );

        await ctx.telegram
          .deleteMessage(
            ctx.chat.id,
            loadingMsg.message_id
          )
          .catch(() => {});

        if (
          res &&
          res.status === 'success' &&
          res.data?.attribute
        ) {
          const payload = res.data.attribute;

          await saveSession(ctx.from.id, {
            token: payload.token,
            msisdn: payload.msisdn,
            userId: payload.user_id,
            subscriberId:
              payload.subscriber_id ||
              payload.subscriberId ||
              payload.accountId,
            refreshToken: payload.refresh_token,
            fullPayload: payload,
          });

          await ctx.reply(
            `${pe(PE.check, '✅')} <b>ATOM အကောင့်ဝင်တာ အောင်မြင်သွားပါပြီ။</b> 🎉`,
            {
              parse_mode: 'HTML',
              ...getAtomReplyKeyboard(true),
            }
          );

          return ctx.scene.leave();
        }

        const errMsg =
          res?.errors?.message?.message ||
          res?.message ||
          res?.errors?.title ||
          '';

        const errorText = String(errMsg).toLowerCase();

        if (
          errorText.includes('expired') ||
          errorText.includes('otp') ||
          errorText.includes('invalid')
        ) {
          await ctx.reply(
            `${pe(PE.check, '❌')} <b>OTP မှားနေပါတယ် သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '🔄')} /start ကိုနှိပ်ပြီး ပြန်စမ်းကြည့်ပေးပါဗျ။`,
            {
              parse_mode: 'HTML',
            }
          );
        } else {
          await ctx.reply(
            `${pe(PE.check, '❌')} <b>OTP အတည်ပြုလို့ မရသေးပါဘူး။</b>\n\n` +
            `${pe(PE.notification, '🔄')} /start ကိုနှိပ်ပြီး ပြန်စမ်းကြည့်ပေးပါဗျ။`,
            {
              parse_mode: 'HTML',
            }
          );
        }

        return ctx.scene.leave();
      } catch (error) {
        if (loadingMsg) {
          await ctx.telegram
            .deleteMessage(
              ctx.chat.id,
              loadingMsg.message_id
            )
            .catch(() => {});
        }

        console.error('VERIFY OTP Error:', error);

        await ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP စစ်ဆေးနေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error('AUTH_WIZARD Step 3 Error:', error);

      await ctx.reply(
        `${pe(PE.check, '❌')} <b>လုပ်ဆောင်နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      ).catch(() => {});

      return ctx.scene.leave();
    }
  }
);

/** User-provided real Premium custom emoji IDs */
const PE = {
  atom: '6086881489306262813',
  myid: '6143236322132759069',
  home: '5321429707688801442',
  notification: '6087125151390898916',
  userId: '6086658073697459541',
  fullName: '4907231385309152742',
  language: '5985469924103952043',
  otp: '5425142567907905356',
  forceJoin: '6143188935758581961',
  check: '6087007709805157399',       // အမှန်ခြစိမှန်သမျှ
  loading: '6199645073978692518',     // ⏳
  balance: '4965219701572503640',     // လက်ကျန်ငွေ
  data: '5204314036950279322',
  voice: '5228815030077633224',
  sms: '5438246259724925761',
  chart: '5884161133174067365',       // 📊
  kiki:'6145311946682934319',
  x: '6084521658180180560',
  pph: '6255692258297779790',
  wow: '6070946928709866910',
};

function pe(id: string, fallback: string) {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

/** Premium home: real custom emojis + colored buttons */
function getHomeInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: 'ATOM',
          callback_data: 'home_atom',
          style: 'primary',
          icon_custom_emoji_id: PE.atom,
        },
        {
          text: 'MYTEL',
          callback_data: 'home_mytel',
          style: 'primary',
          icon_custom_emoji_id: PE.myid,
        },
      ],
      [
        {
          text: 'အသုံးပြုနည်း',
          callback_data: 'home_help',
          style: 'success',
          icon_custom_emoji_id: PE.notification,
        },
        {
          text: 'Profile',
          callback_data: 'home_profile',
          style: 'success',
          icon_custom_emoji_id: PE.userId,
        },
      ],
    ],
  };
}

function getHomeMessageText(user?: { id: number; username?: string; first_name?: string; last_name?: string }) {
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = user?.username ? `@${user.username}` : '—';
  const userId = user?.id ?? '—';

  return (
    `${pe(PE.wow, '🏠')} <b>Ki Ki BOT</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.userId, '👤')} <b>Your Profile</b>\n` +
    `├ ${pe(PE.userId, '🆔')} ID: <code>${userId}</code>\n` +
    `├ ${pe(PE.fullName, '📛')} Name: <b>${fullName}</b>\n` +
    `└ ${pe(PE.language, '🔗')} Username: ${username}\n\n` +
    `${pe(PE.notification, '🎮')} <b>Game များ ရွေးချယ်ပါ</b>\n\n` +
    `${pe(PE.atom, '🔵')} <b>ATOM</b>\n` +
    `  └ TOH TOH · ရွှေလယ်တော\n\n` +
    `${pe(PE.myid, '🟠')} <b>MYTEL</b>\n` +
    `  └ OU Game · Pirate War\n`
  );
}

/** ATOM submenu – reply keyboard (feature buttons) with colorful emojis */
function getAtomReplyKeyboard(loggedIn: boolean) {
  if (!loggedIn) {
    return Markup.keyboard([
      ['🔵 🔑 ATOM အကောင့်ဝင်ရန်'],
      ['🏠 ပင်မစာမျက်နှာ'],
    ]).resize();
  }
  return Markup.keyboard([
    ['💰 လက်ကျန်ငွေစစ်ရန်', '📊 ပွိုင့်စစ်ရန်'],
    ['🎟️ TohToh ကူပွန်', '🎮 TohToh ဆော့ရန်'],
    ['🔴 TohToh Live ဝယ်ယူရန်'],
    ['🌾 ရွှေလယ်တော ကူပွန်', '🐔 ရွှေလယ်တော ဆော့ရန်'],
    ['🟡 ရွှေလယ်တော Live ဝယ်ယူရန်'],
    ['🎁 Daily Point Claim', '🔄 ATOM ထွက်ရန်'],
    ['🏠 ပင်မစာမျက်နှာ'],
  ]).resize();
}

/** MYTEL main menu after login */
function getMytelReplyKeyboard(loggedIn: boolean) {
  if (!loggedIn) {
    return Markup.keyboard([
      ['🟠 🔐 MYTEL Login (OTP)'],
      ['🔑 Access Token Login'],
      ['🏠 ပင်မစာမျက်နှာ'],
    ]).resize();
  }
  return Markup.keyboard([
    ['📊 Data စစ်ရန်', '🔄 Point Exchange'],
    ['🛒 Mytel Package ဝယ်ရန်', '📜 Point History'],
    ['🎁 Daily Claim', '📡 Network Test'],
    ['😎 Ou Game ဆော့မယ်', '⛵ Pirate War ဆော့မယ်'],
    ['🔄 MYTEL Logout'],
    ['🏠 ပင်မစာမျက်နှာ'],
  ]).resize();
}

/** OU Game submenu */
function getOuGameKeyboard() {
  return Markup.keyboard([
    ['🎮 OU Game ဆော့ရန်', '🎁 MYTEL Daily'],
    ['👤 MYTEL Profile', '🎫 MYTEL Turns'],
    ['🛒 MYTEL Store', '📋 MYTEL History'],
    ['🏆 MYTEL Leaderboard'],
    ['◀️ နောက်သို့'],
  ]).resize();
}

/** Pirate War submenu */
function getPirateWarKeyboard(battling = false) {
  if (battling) {
    return Markup.keyboard([
      ['🛑 ရပ်မယ်'],
      ['◀️ နောက်သို့'],
    ]).resize();
  }
  return Markup.keyboard([
    ['👤 Pirate Profile', '⚔️ Auto Battle'],
    ['🎰 Lucky Spin', '🔄 Pirate Exchange'],
    ['⚡ Buy Energy', '🛑 ရပ်မယ်'],
    ['◀️ နောက်သို့'],
  ]).resize();
}

async function getMainKeyboardForUser(tgUserId: number) {
  // After actions, still useful as reply keyboard for the active section
  const atomSess = await getSession(tgUserId);
  const myidSess = await getMyIdSession(tgUserId);
  if (atomSess) return getAtomReplyKeyboard(true);
  if (myidSess) return getMytelReplyKeyboard(true);
  // default: hide reply keyboard, user uses home inline
  return Markup.removeKeyboard();
}

/** backward-compatible wrapper used by old ATOM code */
function getMainKeyboard(isLoggedIn: boolean) {
  return getAtomReplyKeyboard(isLoggedIn);
}

async function sendHomeMenu(ctx: any) {
  const user = ctx.from
    ? {
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
      }
    : undefined;
  const text = getHomeMessageText(user);
  const extra = {
    parse_mode: 'HTML' as const,
    reply_markup: getHomeInlineKeyboard(),
  };
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch {
      // fall through to reply
    }
  }
  await ctx.reply(text, extra);
}

// ---------- MyID OTP Wizard ----------
const myidAuthWizard = new Scenes.WizardScene<any>(
  'MYID_AUTH_WIZARD',

  // =========================
  // STEP 1 — PHONE NUMBER
  // =========================
  async (ctx) => {
    try {
      await ctx.reply(
        `${pe(PE.myid, '📲')} <b>MYTEL ဖုန်းနံပါတ် ရိုက်ထည့်ပေးပါ။</b>\n\n` +
        `${pe(PE.notification, '📱')} ဥပမာ - <code>09xxxxxxxx</code>\n\n` +
        `${pe(PE.check, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
        {
          parse_mode: 'HTML',
        }
      );

      return ctx.wizard.next();
    } catch (error) {
      console.error('MYID_AUTH_WIZARD Step 1 Error:', error);
      return ctx.scene.leave();
    }
  },

  // =========================
  // STEP 2 — SEND OTP
  // =========================
  async (ctx) => {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(
          'လုပ်ဆောင်ချက်ကို ဆက်လုပ်ပါ သို့မဟုတ် /cancel ကိုနှိပ်ပါ။'
        ).catch(() => {});
        return;
      }

      if (!ctx.message || !('text' in ctx.message)) {
        return;
      }

      const text = String(ctx.message.text).trim();

      // Cancel
      if (text.toLowerCase() === '/cancel') {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.x, '❌')} <b>MYTEL အကောင့်ဝင်ခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Other commands
      if (text.startsWith('/')) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.x, '❌')} <b>လုပ်ဆောင်ချက်ကို ရပ်စဲလိုက်ပါသည်။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Normalize phone
      let phone = text.replace(/\D/g, '');

      if (phone.startsWith('95')) {
        phone = phone.slice(2);
      }

      if (phone.startsWith('0')) {
        phone = phone.slice(1);
      }

      // Validate phone
      if (phone.length < 7 || phone.length > 10) {
        return ctx.reply(
          `${pe(PE.x, '❌')} <b>ဖုန်းနံပါတ် မှားယွင်းနေပါတယ်။</b>\n\n` +
          `${pe(PE.notification, '📱')} ဥပမာ - <code>09xxxxxxxx</code>\n` +
          `ကျေးဇူးပြု၍ ပြန်ရိုက်ပေးပါ။`,
          {
            parse_mode: 'HTML',
          }
        );
      }

      ctx.wizard.state.phone = phone;

      let loadingMsg: any;

      try {
        loadingMsg = await ctx.reply(
          `${pe(PE.loading, '⏳')} <b>OTP ပို့နေပါပြီ...</b>`,
          {
            parse_mode: 'HTML',
          }
        );

        const ok = await MyIdService.sendOtp(phone);

        await ctx.telegram
          .deleteMessage(
            ctx.chat!.id,
            loadingMsg.message_id
          )
          .catch(() => {});

        if (!ok) {
          await ctx.reply(
            `${pe(PE.x, '❌')} <b>OTP ပို့မရပါ။</b>\n` +
            `ခဏနေမှ ပြန်စမ်းပါဗျ။`,
            {
              parse_mode: 'HTML',
            }
          );

          return ctx.scene.leave();
        }

        await ctx.reply(
          `${pe(PE.otp, '📨')} <b>OTP ပို့လိုက်ပါပြီ။</b>\n\n` +
          `${pe(PE.notification, '📱')} <b>+95${phone}</b> ကို OTP ပို့ထားပါတယ်။\n\n` +
          `${pe(PE.check, '🔢')} ဂဏန်း <b>၆ လုံး</b> ရိုက်ထည့်ပေးပါ။\n\n` +
          `${pe(PE.check, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.wizard.next();
      } catch (error) {
        if (loadingMsg) {
          await ctx.telegram
            .deleteMessage(
              ctx.chat!.id,
              loadingMsg.message_id
            )
            .catch(() => {});
        }

        console.error(
          'MYTEL SEND OTP Error:',
          error
        );

        await ctx.reply(
          `${pe(PE.x, '❌')} <b>OTP ပို့နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error(
        'MYID_AUTH_WIZARD Step 2 Error:',
        error
      );

      await ctx.reply(
        `${pe(PE.check, '❌')} <b>လုပ်ဆောင်နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      ).catch(() => {});

      return ctx.scene.leave();
    }
  },

  // =========================
  // STEP 3 — VERIFY OTP
  // =========================
  async (ctx) => {
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(
          'လုပ်ဆောင်ချက်ကို ဆက်လုပ်ပါ သို့မဟုတ် /cancel ကိုနှိပ်ပါ။'
        ).catch(() => {});
        return;
      }

      if (!ctx.message || !('text' in ctx.message)) {
        return;
      }

      const text = String(ctx.message.text).trim();

      // Cancel
      if (text.toLowerCase() === '/cancel') {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>MYTEL OTP အတည်ပြုခြင်းကို ပယ်ဖျက်လိုက်ပါပြီ။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      // Other commands
      if (text.startsWith('/')) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>လုပ်ဆောင်ချက်ကို ရပ်စဲလိုက်ပါသည်။</b>`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      const otp = text.replace(/\D/g, '');

      if (otp.length !== 6) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP ဂဏန်း ၆ လုံး ပြည့်အောင် ရိုက်ပါ။</b>\n\n` +
          `${pe(PE.notification, '❌')} မလုပ်လိုပါက <code>/cancel</code> ကိုနှိပ်ပါ။`,
          {
            parse_mode: 'HTML',
          }
        );
      }

      const phone = ctx.wizard.state.phone;

      if (!phone) {
        await ctx.scene.leave();

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>ဖုန်းနံပါတ် Session မတွေ့တော့ပါဘူး။</b>\n` +
          `/start ကိုနှိပ်ပြီး ပြန်စမ်းကြည့်ပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      let loadingMsg: any;

      try {
        loadingMsg = await ctx.reply(
          `${pe(PE.loading, '⏳')} <b>OTP မှန်မမှန် စစ်ဆေးနေပါတယ်...</b>`,
          {
            parse_mode: 'HTML',
          }
        );

        const session = await MyIdService.verifyOtp(
          phone,
          otp
        );

        await ctx.telegram
          .deleteMessage(
            ctx.chat!.id,
            loadingMsg.message_id
          )
          .catch(() => {});

        if (!session) {
          await ctx.reply(
            `${pe(PE.check, '❌')} <b>OTP မှားနေပါတယ် သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '🔄')} /start ကိုနှိပ်ပြီး ပြန်စမ်းကြည့်ပေးပါဗျ။`,
            {
              parse_mode: 'HTML',
            }
          );

          return ctx.scene.leave();
        }

        // Save MYTEL session
        await saveMyIdSession(
          ctx.from!.id,
          session
        );

        await ctx.reply(
          `${pe(PE.check, '✅')} <b>MYTEL အကောင့်ဝင်တာ အောင်မြင်ပါပြီ။</b> 🎉`,
          {
            parse_mode: 'HTML',
            ...getMytelReplyKeyboard(true),
          }
        );

        return ctx.scene.leave();
      } catch (error) {
        if (loadingMsg) {
          await ctx.telegram
            .deleteMessage(
              ctx.chat!.id,
              loadingMsg.message_id
            )
            .catch(() => {});
        }

        console.error(
          'MYTEL VERIFY OTP Error:',
          error
        );

        await ctx.reply(
          `${pe(PE.check, '❌')} <b>OTP စစ်ဆေးနေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          {
            parse_mode: 'HTML',
          }
        );

        return ctx.scene.leave();
      }
    } catch (error) {
      console.error(
        'MYID_AUTH_WIZARD Step 3 Error:',
        error
      );

      await ctx.reply(
        `${pe(PE.check, '❌')} <b>လုပ်ဆောင်နေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      ).catch(() => {});

      return ctx.scene.leave();
    }
  }
);

const stage = new Scenes.Stage([authWizard, myidAuthWizard]);
bot.use(session());
bot.use(stage.middleware());

// Force-join + ban middleware
bot.use(async (ctx, next) => {
  if (ctx.from) {
    await recordUser(ctx.from).catch(console.error);
    const banned = await isUserBanned(ctx.from.id);
    if (banned) {
      return ctx.reply('❌ သင်၏အကောင့်ကို ပိတ်ပင်ထားပါသည်။ (You are banned)').catch(() => {});
    }
  }

  // Allow join-check callback and admin always
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery && ctx.callbackQuery.data === 'check_join') {
    return next();
  }
  if (isAdmin(ctx)) return next();

  // Skip force-join only for /start and pure cancel
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (text === '/start' || text === '/cancel') return next();

  // For all other interactions enforce channel join
  if (ctx.from && !(await enforceChannelJoin(ctx))) {
    return; // already showed prompt
  }

  if (ctx.message && 'text' in ctx.message) {
    const text = ctx.message.text;
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      recordCommand(cmd).catch(console.error);
    } else {
      const keywords = ['အကောင့်ဝင်ရန်', 'လက်ကျန်', 'ပွိုင့်', 'tohtoh', 'ရွှေလယ်တော', 'claim', 'mytel', 'ou game'];
      const matched = keywords.find(k => text.toLowerCase().includes(k));
      if (matched) {
         recordCommand(`menu_${matched}`).catch(console.error);
      }
    }
  } else if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    const actionBase = data.split('_')[0];
    recordCommand(`action_${actionBase}`).catch(console.error);
  }
  return next();
});

bot.start(async (ctx) => {
  const allowed = await enforceChannelJoin(ctx);
  if (!allowed) return;
  // Remove old reply keyboard then show premium home with user profile
  await ctx.reply('✨', Markup.removeKeyboard()).catch(() => {});
  await sendHomeMenu(ctx);
});

// Home inline buttons ( style)
bot.action('home_atom', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const sess = await getSession(ctx.from!.id);
  const kb = getAtomReplyKeyboard(!!sess);
  const status = sess
    ? `${pe(PE.check, '✅')} ATOM login ဝင်ပြီးပါပြီ။ အောက်က ခလုတ်များသုံးပါ။`
    : `${pe(PE.otp, '🔑')} အရင် ATOM အကောင့်ဝင်ရန် နှိပ်ပါ။`;
  await ctx.reply(
    `${pe(PE.atom, '🔵')} <b>ATOM Menu</b>\nTOH TOH · ရွှေလယ်တော\n\n${status}`,
    { parse_mode: 'HTML', ...kb }
  );
});

bot.action('home_mytel', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const sess = await getMyIdSession(ctx.from!.id);
  const kb = getMytelReplyKeyboard(!!sess);
  const status = sess
    ? `${pe(PE.check, '✅')} MYTEL login ဝင်ပြီးပါပြီ။ အောက်က ခလုတ်များသုံးပါ။`
    : `${pe(PE.otp, '🔐')} အရင် MYTEL Login နှိပ်ပါ။`;
  await ctx.reply(
    `${pe(PE.myid, '🟠')} <b>MYTEL Menu</b>\nData · Point Exchange · Package · OU Game · Daily\n\n${status}`,
    { parse_mode: 'HTML', ...kb }
  );
});

bot.action('home_help', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    `${pe(PE.notification, '📖')} <b>အသုံးပြုနည်း</b>\n\n` +
      ` ${pe(PE.atom, '🔵')} <b>ATOM</b> ခလုတ် → အကောင့်ဝင် → TohToh / ရွှေလယ်တော\n` +
      ` ${pe(PE.myid, '🟠')} <b>MYTEL</b> ခလုတ် → Login → OU Game / Daily / Store / History / Leaderboard\n` +
      ` ${pe(PE.forceJoin, '📢')} Channel join လိုအပ်ရင် bot က ပြောပါမယ်\n\n` +
      `${pe(PE.home, '🏠')} /start နှိပ်ပြီး ပင်မစာမျက်နှာ ပြန်သွားနိုင်ပါတယ်။`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'ပင်မစာမျက်နှာ',
            callback_data: 'home_main',
            style: 'primary',
            icon_custom_emoji_id: PE.home,
          },
        ]],
      },
    }
  );
});

bot.action('home_profile', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const u = ctx.from;
  if (!u) return;
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = u.username ? `@${u.username}` : 'မရှိပါ';
  await ctx.reply(
    `${pe(PE.userId, '👤')} <b>Your Telegram Profile</b>\n` +
      `════════════════════\n\n` +
      `${pe(PE.userId, '🆔')} <b>User ID:</b> <code>${u.id}</code>\n` +
      `${pe(PE.fullName, '📛')} <b>Full Name:</b> ${fullName}\n` +
      `${pe(PE.language, '🔗')} <b>Username:</b> ${username}\n` +
      `${pe(PE.language, '🌐')} <b>Language:</b> ${u.language_code || '—'}\n` +
      `${pe(PE.check, '⭐')} <b>Premium:</b> ${u.is_premium ? 'Yes' : 'No'}`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'ပင်မစာမျက်နှာ',
            callback_data: 'home_main',
            style: 'primary',
            icon_custom_emoji_id: PE.home,
          },
        ]],
      },
    }
  );
});

bot.action('home_main', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendHomeMenu(ctx);
});

// ==================== HOME ====================
bot.hears('🏠 ပင်မစာမျက်နှာ', async (ctx) => {
  try {
    await ctx.reply('🏠', Markup.removeKeyboard()).catch(() => {});
    await sendHomeMenu(ctx);
  } catch (error) {
    console.error('Home menu error:', error);
  }
});


// ==================== ATOM LOGIN ====================
bot.hears(
  ['🔑 အကောင့်ဝင်ရန်', '🔑 ATOM အကောင့်ဝင်ရန်', '🔵 🔑 ATOM အကောင့်ဝင်ရန်'],
  async (ctx) => {
    try {
      return ctx.scene.enter('AUTH_WIZARD');
    } catch (error) {
      console.error('ATOM login scene error:', error);
    }
  }
);


// ==================== ATOM LOGOUT ====================
bot.hears(
  ['🔄 အကောင့်ထွက်ရန်', '🔄 ATOM ထွက်ရန်'],
  async (ctx) => {
    try {
      await clearSession(ctx.from!.id);

      await ctx.reply(
        `${pe(PE.check, '👋')} <b>ATOM အကောင့် ထွက်လိုက်ပါပြီ။</b>`,
        {
          parse_mode: 'HTML',
          ...getAtomReplyKeyboard(false),
        }
      );
    } catch (error) {
      console.error('ATOM logout error:', error);

      await ctx.reply(
        `${pe(PE.x, '❌')} အကောင့်ထွက်ရာတွင် အခက်အခဲရှိနေပါတယ်။`,
        {
          parse_mode: 'HTML',
          ...getAtomReplyKeyboard(false),
        }
      ).catch(() => {});
    }
  }
);


// ==================== MYTEL LOGIN ====================
bot.hears(
  ['🔐 MYTEL Login', '🟠 🔐 MYTEL Login', '🟠 🔐 MYTEL Login (OTP)'],
  async (ctx) => {
    try {
      return ctx.scene.enter('MYID_AUTH_WIZARD');
    } catch (error) {
      console.error('MYTEL login scene error:', error);
    }
  }
);


// ==================== MYTEL LOGOUT ====================
bot.hears('🔄 MYTEL Logout', async (ctx) => {
  try {
    await clearMyIdSession(ctx.from!.id);

    await ctx.reply(
      `${pe(PE.check, '👋')} <b>MYTEL အကောင့် ထွက်လိုက်ပါပြီ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  } catch (error) {
    console.error('MYTEL logout error:', error);

    await ctx.reply(
      `${pe(PE.x, '❌')} အကောင့်ထွက်ရာတွင် အခက်အခဲရှိနေပါတယ်။`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    ).catch(() => {});
  }
});


// ==================== FORCE JOIN CHECK ====================
bot.action('check_join', async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    if (!ctx.from) return;

    const { ok, missing } = await checkAllChannelsMembership(ctx.from.id);

    if (ok) {
      await ctx.editMessageText(
        `${pe(PE.check, '✅')} <b>Channel များ Join ပြီးပါပြီ။</b>\n\n` +
        `${pe(PE.atom, '🚀')} ရှေ့ဆက်အသုံးပြုလို့ရပါပြီ။`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await sendHomeMenu(ctx);
    } else {
      await showJoinChannelsPrompt(ctx, missing);
    }
  } catch (error) {
    console.error('check_join error:', error);

    await ctx.reply(
      `${pe(PE.notification, '❌')} Channel Join စစ်ဆေးရာတွင် အခက်အခဲရှိနေပါတယ်။`
    ).catch(() => {});
  }
});


// ==================== MYTEL TOKEN WRAPPER ====================
async function withMyIdToken(
  ctx: any,
  fn: (token: string, sess: MyIdSession) => Promise<void>
) {
  try {
    const sess = await getMyIdSession(ctx.from.id);

    if (!sess) {
      const kb = await getMainKeyboardForUser(ctx.from.id);

      return ctx.reply(
        `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
        {
          parse_mode: 'HTML',
          ...kb,
        }
      );
    }

    const wait = await ctx.reply(
      `${pe(PE.loading, '⏳')} <b>Game Token ရယူနေပါတယ်...</b>`,
      { parse_mode: 'HTML' }
    );

    const token = await MyIdService.getGameToken(sess);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    if (!token) {
      await clearMyIdSession(ctx.from.id);

      const kb = await getMainKeyboardForUser(ctx.from.id);

      return ctx.reply(
        `${pe(PE.x, '❌')} <b>Session သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.myid, '🔐')} MYTEL Login ပြန်လုပ်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...kb,
        }
      );
    }

    await fn(token, sess);
  } catch (error) {
    console.error('withMyIdToken error:', error);

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>ခဏတာ အခက်အခဲဖြစ်နေပါတယ်။</b>\n\n` +
      `ခဏနေမှ ပြန်ကြိုးစားပေးပါ။`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
}


// ==================== DATA စစ်ရန် (Loyalty Balance) ====================
bot.hears('📊 Data စစ်ရန်', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);

    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
        ...kb,
      }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Data / Balance / Point စစ်ဆေးနေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const info = await MyIdService.getLoyaltyAccountInfo(sess);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    if (!info.ok) {
      let msg =
        `${pe(PE.notification, '⚠️')} <b>Data စစ်ရန်</b>\n` +
        `════════════════════\n\n` +
        `${info.message || 'အချက်အလက် မရရှိပါ။'}\n\n` +
        `${pe(PE.notification, '📱')} <b>Phone:</b> <code>${sess.phone}</code>\n`;

      if (info.raw) {
        const preview = JSON.stringify(info.raw).slice(0, 400);

        msg +=
          `\n${pe(PE.data, '📄')} <b>Response:</b>\n` +
          `<code>${preview}</code>`;
      }

      return ctx.reply(msg, {
        parse_mode: 'HTML',
      });
    }

    const fmtKyats = (val?: string) => {
      if (
        val === undefined ||
        val === null ||
        String(val).trim() === ''
      ) {
        return 'N/A';
      }

      const n = Number(val);

      return Number.isFinite(n)
        ? `${n.toLocaleString()} ကျပ်`
        : `${val} ကျပ်`;
    };

    const fmtPoint = (val?: string) => {
      if (
        val === undefined ||
        val === null ||
        String(val).trim() === ''
      ) {
        return 'N/A';
      }

      const n = Number(val);

      return Number.isFinite(n)
        ? `${n.toLocaleString()} Points`
        : `${val} Points`;
    };

    let text =
      `${pe(PE.myid, '📊')} <b>MYTEL Data / Balance</b>\n` +
      `════════════════════\n\n` +

      `${pe(PE.pph, '📱')} <b>Phone:</b> <code>${sess.phone}</code>\n\n` +

      `${pe(PE.balance, '💰')} <b>Balance:</b> ${fmtKyats(info.balance)}\n` +

      `${pe(PE.data, '📶')} <b>Data:</b> ${
        info.mb != null
          ? MyIdService.formatDataAmount(info.mb)
          : 'N/A'
      }\n` +

      `${pe(PE.voice, '📞')} <b>Voice:</b> ${
        info.voice != null
          ? MyIdService.formatVoiceAmount(info.voice)
          : 'N/A'
      }\n` +

      `${pe(PE.chart, '⭐')} <b>Point:</b> ${fmtPoint(info.point)}\n`;

    if (info.sms) {
      text +=
        `${pe(PE.sms, '💬')} <b>SMS:</b> ` +
        `${Number(info.sms).toLocaleString()}\n`;
    }

    text +=
      `\n${pe(PE.check, '✅')} <b>Data စစ်ဆေးပြီးပါပြီ။</b>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
    });

  } catch (error) {
    console.error('Data စစ်ရန် error:', error);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.x, '❌')} <b>Data စစ်ဆေးရာတွင် အခက်အခဲရှိနေပါတယ်။</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});


// ==================== POINT EXCHANGE ====================
bot.hears('🔄 Point Exchange', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  // ==============================
  // MYTEL Login Check
  // ==============================
  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);

    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
        ...kb,
      }
    );
  }

  // ==============================
  // Point Exchange Menu
  // ==============================
  await ctx.reply(
    `${pe(PE.myid, '🔄')} <b>Point Exchange</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.chart, '⭐')} <b>Point Exchange Service</b>\n\n` +
    `${pe(PE.notification, '📋')} အမျိုးအစား ရွေးချယ်ပါ။`,
    {
      parse_mode: 'HTML',

      reply_markup: {
        inline_keyboard: [
          // ==========================
          // Super Pack + Data
          // ==========================
          [
            {
              text: 'Super Pack',
              callback_data: 'px:cat:super',
              style: 'primary',
              icon_custom_emoji_id: PE.kiki,
            },
            {
              text: 'Data (MB)',
              callback_data: 'px:cat:data',
              style: 'primary',
              icon_custom_emoji_id: PE.data,
            },
          ],

          // ==========================
          // Voice + SMS
          // ==========================
          [
            {
              text: 'Voice',
              callback_data: 'px:cat:voice',
              style: 'success',
              icon_custom_emoji_id: PE.voice,
            },
            {
              text: 'SMS',
              callback_data: 'px:cat:sms',
              style: 'success',
              icon_custom_emoji_id: PE.sms,
            },
          ],

          // ==========================
          // Data Check
          // ==========================
          [
            {
              text: 'Data စစ်ရန်',
              callback_data: 'px:check',
              style: 'primary',
              icon_custom_emoji_id: PE.chart,
            },
          ],
        ],
      },
    }
  );
});

bot.action('px:check', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const sess = await getMyIdSession(ctx.from!.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Data / Balance / Point စစ်ဆေးနေပါတယ်...</b>`,
    {
      parse_mode: 'HTML',
    }
  );

  try {
    const info = await MyIdService.getLoyaltyAccountInfo(sess);

    await ctx.telegram
      .deleteMessage(ctx.chat!.id, wait.message_id)
      .catch(() => {});

    if (!info.ok) {
      return ctx.reply(
        `${pe(PE.notification, '⚠️')} <b>Data စစ်ရန်</b>\n` +
        `════════════════════\n\n` +
        `${info.message || 'အချက်အလက် မရရှိပါ။'}`,
        {
          parse_mode: 'HTML',
        }
      );
    }

    let text =
      `${pe(PE.myid, '📊')} <b>MYTEL Data / Balance</b>\n` +
      `════════════════════\n\n` +

      `${pe(PE.pph, '📱')} <b>Phone:</b> ` +
      `<code>${sess.phone}</code>\n\n` +

      `${pe(PE.balance, '💰')} <b>Balance:</b> ` +
      `${
        info.balance != null
          ? Number(info.balance).toLocaleString() + ' ကျပ်'
          : 'N/A'
      }\n` +

      `${pe(PE.data, '📶')} <b>Data:</b> ` +
      `${
        info.mb != null
          ? MyIdService.formatDataAmount(info.mb)
          : 'N/A'
      }\n` +

      `${pe(PE.voice, '📞')} <b>Voice:</b> ` +
      `${
        info.voice != null
          ? MyIdService.formatVoiceAmount(info.voice)
          : 'N/A'
      }\n` +

      `${pe(PE.chart, '⭐')} <b>Point:</b> ` +
      `${
        info.point != null
          ? Number(info.point).toLocaleString() + ' Points'
          : 'N/A'
      }\n`;

    if (info.sms) {
      text +=
        `${pe(PE.sms, '💬')} <b>SMS:</b> ` +
        `${Number(info.sms).toLocaleString()}\n`;
    }

    text +=
      `\n${pe(PE.check, '✅')} <b>အချက်အလက် စစ်ဆေးပြီးပါပြီ။</b>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
    });

  } catch (e) {
    console.error('px:check error:', e);

    await ctx.telegram
      .deleteMessage(ctx.chat!.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>Data စစ်ဆေးရာတွင် အခက်အခဲရှိနေပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါ။`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});

bot.action(/^px:cat:(super|data|voice|sms)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const cat = ctx.match[1] as keyof typeof MYID_EXCHANGE_PACKS;
  const packs = MYID_EXCHANGE_PACKS[cat];

  if (!packs?.length) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Package မရှိပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const titles: Record<string, string> = {
    super: '⭐ Super Pack',
    data: '📶 Data (MB)',
    voice: '📞 Voice (On-Net)',
    sms: '💬 SMS',
  };

  // ==============================
  // Package Buttons
  // ==============================
  const buttons = packs.map((p) => [
    {
      text: `${p.data} ${p.unit}  ·  ${p.price} pts`,
      callback_data: `px:buy:${p.code}`,
      style:
        cat === 'voice' || cat === 'sms'
          ? 'success'
          : 'primary',
      icon_custom_emoji_id:
        cat === 'super'
          ? PE.kiki
          : cat === 'data'
          ? PE.data
          : cat === 'voice'
          ? PE.voice
          : PE.sms,
    },
  ]);

  // ==============================
  // Back Button
  // ==============================
  buttons.push([
    {
      text: 'နောက်သို့',
      callback_data: 'px:back',
      style: 'success',
      icon_custom_emoji_id: PE.notification,
    },
  ]);

  // ==============================
  // Message
  // ==============================
  const message =
    `${pe(PE.myid, '🔄')} <b>${titles[cat] || cat}</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.notification, '📋')} လဲလှယ်မည့် pack ကို ရွေးပါ။\n` +
    `${pe(PE.chart, '⭐')} <i>price = လိုအပ်သော Point</i>`;

  // ==============================
  // Edit Message
  // ==============================
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buttons,
    },
  }).catch(async () => {
    // Edit မရရင် Reply ပြန်ပို့
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons,
      },
    }).catch(() => {});
  });
});

bot.action('px:back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  await ctx.editMessageText(
    `${pe(PE.myid, '🔄')} <b>Point Exchange</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.chart, '⭐')} Point ဖြင့် MB / Voice / SMS လဲလှယ်နိုင်ပါတယ်။\n` +
    `${pe(PE.notification, '📋')} အမျိုးအစား ရွေးပါ။`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Super Pack',
              callback_data: 'px:cat:super',
              style: 'primary',
              icon_custom_emoji_id: PE.kiki,
            },
            {
              text: 'Data (MB)',
              callback_data: 'px:cat:data',
              style: 'primary',
              icon_custom_emoji_id: PE.data,
            },
          ],
          [
            {
              text: 'Voice',
              callback_data: 'px:cat:voice',
              style: 'success',
              icon_custom_emoji_id: PE.voice,
            },
            {
              text: 'SMS',
              callback_data: 'px:cat:sms',
              style: 'success',
              icon_custom_emoji_id: PE.sms,
            },
          ],
          [
            {
              text: 'Data စစ်ရန်',
              callback_data: 'px:check',
              style: 'primary',
              icon_custom_emoji_id: PE.chart,
            },
          ],
        ],
      },
    }
  ).catch(() => {});
});

bot.action(/^px:buy:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Processing...').catch(() => {});
  const code = ctx.match[1];
  const pack = findExchangePack(code);
  const sess = await getMyIdSession(ctx.from!.id);

  if (!sess) {
    return ctx.reply(`${pe(PE.myid, '❌')} MYTEL Login လုပ်ပေးပါ။`, { parse_mode: 'HTML' });
  }
  if (!pack) {
    return ctx.reply('❌ Package code မမှန်ကန်ပါ။');
  }

  const confirmKb = {
    inline_keyboard: [
      [
        { text: '✅ အတည်ပြုမယ်', callback_data: `px:confirm:${code}` },
        { text: '❌ ပယ်ဖျက်', callback_data: 'px:back' },
      ],
    ],
  };

  await ctx.reply(
    `${pe(PE.notification, '⚠️')} <b>အတည်ပြုပါ</b>\n\n` +
    `📦 <b>${pack.data} ${pack.unit}</b>\n` +
    `⭐ လိုအပ် Point: <b>${pack.price}</b>\n` +
    `🔖 Code: <code>${pack.code}</code>\n\n` +
    `Point ဖြတ်ပြီး လဲလှယ်မှာ သေချာပါသလား?`,
    { parse_mode: 'HTML', reply_markup: confirmKb }
  );
});

bot.action(/^px:confirm:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Exchanging...').catch(() => {});
  const code = ctx.match[1];
  const pack = findExchangePack(code);
  const sess = await getMyIdSession(ctx.from!.id);

  if (!sess) {
    return ctx.editMessageText('❌ MYTEL Login လိုအပ်ပါတယ်။').catch(() => {});
  }
  if (!pack) {
    return ctx.editMessageText('❌ Package မရှိပါ။').catch(() => {});
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>${pack.data} ${pack.unit}</b> လဲလှယ်နေပါတယ်...`,
    { parse_mode: 'HTML' }
  );

  try {
    const result = await MyIdService.exchangePack(sess, code);
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});

    if (result.ok) {
      await ctx.reply(
        `${pe(PE.check, '✅')} <b>Exchange အောင်မြင်ပါသည်!</b>\n\n` +
        `📦 ${pack.data} ${pack.unit}\n` +
        `⭐ ဖြတ် Point: ${pack.price}\n` +
        `🔖 ${pack.code}\n\n` +
        `${result.message}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `${pe(PE.notification, '❌')} <b>Exchange မအောင်မြင်ပါ</b>\n\n` +
        `📦 ${pack.data} ${pack.unit}\n` +
        `⭐ ${pack.price} pts\n\n` +
        `အကြောင်းရင်း: ${result.message}`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (e: any) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ Error: ${e?.message || e}`, { parse_mode: 'HTML' }).catch(() => {});
  }
});


// ==================== MYTEL PACKAGE ဝယ်ရန် (VAS / ကျပ်) ====================
bot.hears('🛒 Mytel Package ဝယ်ရန်', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  // ==============================
  // MYTEL Login Check
  // ==============================
  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);

    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
        ...kb,
      }
    );
  }

  // ==============================
  // Mytel Package Menu
  // ==============================
  await ctx.reply(
    `${pe(PE.myid, '🛒')} <b>Mytel Package ဝယ်ရန်</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.balance, '💰')} Main Balance (ကျပ်) ဖြင့် package ဝယ်ယူနိုင်ပါတယ်။\n` +
    `${pe(PE.notification, '📋')} အမျိုးအစား ရွေးပါ။`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Data',
              callback_data: 'vas:cat:data',
              style: 'primary',
              icon_custom_emoji_id: PE.data,
            },
            {
              text: 'Voice',
              callback_data: 'vas:cat:voice',
              style: 'success',
              icon_custom_emoji_id: PE.voice,
            },
          ],
          [
            {
              text: 'Combo',
              callback_data: 'vas:cat:combo',
              style: 'primary',
              icon_custom_emoji_id: PE.kiki,
            },
            {
              text: 'Shareable',
              callback_data: 'vas:cat:shareable',
              style: 'primary',
              icon_custom_emoji_id: PE.myid,
            },
          ],
          [
            {
              text: 'Roaming',
              callback_data: 'vas:cat:roaming',
              style: 'success',
              icon_custom_emoji_id: PE.notification,
            },
          ],
          [
            {
              text: 'Data စစ်ရန်',
              callback_data: 'px:check',
              style: 'primary',
              icon_custom_emoji_id: PE.chart,
            },
          ],
        ],
      },
    }
  );
});

bot.action(/^vas:cat:(data|voice|combo|shareable|roaming)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const cat = ctx.match[1] as keyof typeof MYTEL_VAS_PACKAGES;
  const packs = MYTEL_VAS_PACKAGES[cat];

  if (!packs?.length) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Package မရှိပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const titles: Record<string, string> = {
    data: '📶 Data Packages',
    voice: '📞 Voice Packages',
    combo: '📦 Combo Packages',
    shareable: '🔗 Shareable Packages',
    roaming: '🌍 Roaming Packages',
  };

  // ==============================
  // Package Buttons
  // ==============================
  const buttons = packs.map((p) => {
    const hot = (p as any).hot ? '🔥 ' : '';

    const emojiId =
      cat === 'data'
        ? PE.data
        : cat === 'voice'
        ? PE.voice
        : cat === 'combo'
        ? PE.kiki
        : cat === 'shareable'
        ? PE.myid
        : PE.notification;

    return [
      {
        text: `${hot}${p.name} · ${Number(p.price).toLocaleString()} ${p.unit}`,
        callback_data: `vas:buy:${p.id}`,
        style:
          cat === 'voice' || cat === 'roaming'
            ? 'success'
            : 'primary',
        icon_custom_emoji_id: emojiId,
      },
    ];
  });

  // ==============================
  // Back Button
  // ==============================
  buttons.push([
    {
      text: 'နောက်သို့',
      callback_data: 'vas:back',
      style: 'success',
      icon_custom_emoji_id: PE.notification,
    },
  ]);

  // ==============================
  // Message
  // ==============================
  const message =
    `${pe(PE.myid, '🛒')} <b>${titles[cat] || cat}</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.notification, '📋')} ဝယ်ယူမည့် package ကို ရွေးပါ။\n` +
    `${pe(PE.balance, '💰')} <i>စျေးနှုန်း = Main Balance (ကျပ်)</i>`;

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    console.error('vas:cat error:', error);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons,
      },
    }).catch(() => {});
  }
});

bot.action('vas:back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const message =
    `${pe(PE.myid, '🛒')} <b>Mytel Package ဝယ်ရန်</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.balance, '💰')} Main Balance (ကျပ်) ဖြင့် package ဝယ်ယူနိုင်ပါတယ်။\n` +
    `${pe(PE.notification, '📋')} အမျိုးအစား ရွေးပါ။`;

  await ctx
    .editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Data',
              callback_data: 'vas:cat:data',
              style: 'primary',
              icon_custom_emoji_id: PE.data,
            },
            {
              text: 'Voice',
              callback_data: 'vas:cat:voice',
              style: 'success',
              icon_custom_emoji_id: PE.voice,
            },
          ],
          [
            {
              text: 'Combo',
              callback_data: 'vas:cat:combo',
              style: 'primary',
              icon_custom_emoji_id: PE.kiki,
            },
            {
              text: 'Shareable',
              callback_data: 'vas:cat:shareable',
              style: 'primary',
              icon_custom_emoji_id: PE.myid,
            },
          ],
          [
            {
              text: 'Roaming',
              callback_data: 'vas:cat:roaming',
              style: 'success',
              icon_custom_emoji_id: PE.notification,
            },
          ],
          [
            {
              text: 'Data စစ်ရန်',
              callback_data: 'px:check',
              style: 'primary',
              icon_custom_emoji_id: PE.chart,
            },
          ],
        ],
      },
    })
    .catch(() => {});
});

bot.action(/^vas:buy:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  const id = ctx.match[1];
  const pack = findVasPackage(id);
  const sess = await getMyIdSession(ctx.from!.id);

  // ==============================
  // MYTEL Login Check
  // ==============================
  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  // ==============================
  // Package Check
  // ==============================
  if (!pack) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Package code မမှန်ကန်ပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  // ==============================
  // Confirm Purchase
  // ==============================
  await ctx.reply(
    `${pe(PE.notification, '⚠️')} <b>အတည်ပြုပါ</b>\n\n` +
    `${pe(PE.kiki, '📦')} <b>${pack.name}</b>\n` +
    `${pe(PE.notification, '📝')} ${pack.desc}\n` +
    `${pe(PE.chart, '📅')} သက်တမ်း: <b>${pack.days}</b>\n` +
    `${pe(PE.balance, '💰')} စျေးနှုန်း: <b>${Number(pack.price).toLocaleString()} ${pack.unit}</b>\n` +
    `${pe(PE.notification, '🔖')} Code: <code>${pack.id}</code>\n` +
    `${pe(PE.myid, '📱')} Phone: <code>${sess.phone}</code>\n\n` +
    `${pe(PE.balance, '💰')} Main Balance မှ ဖြတ်ပြီး ဝယ်မှာ သေချာပါသလား?`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'ဝယ်မယ်',
              callback_data: `vas:confirm:${pack.id}`,
              style: 'success',
              icon_custom_emoji_id: PE.check,
            },
            {
              text: 'ပယ်ဖျက်',
              callback_data: 'vas:back',
              style: 'danger',
              icon_custom_emoji_id: PE.notification,
            },
          ],
        ],
      },
    }
  );
});

bot.action(/^vas:confirm:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Purchasing...').catch(() => {});

  const id = ctx.match[1];
  const pack = findVasPackage(id);
  const sess = await getMyIdSession(ctx.from!.id);

  // ==============================
  // MYTEL Login Check
  // ==============================
  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }

  // ==============================
  // Package Check
  // ==============================
  if (!pack) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Package မရှိပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }

  // ==============================
  // Purchasing
  // ==============================
  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>${pack.name}</b> ဝယ်ယူနေပါတယ်...`,
    {
      parse_mode: 'HTML',
    }
  );

  try {
    const result = await MyIdService.buyVasPackage(
      sess,
      pack.id
    );

    await ctx.telegram
      .deleteMessage(ctx.chat!.id, wait.message_id)
      .catch(() => {});

    // ==============================
    // Purchase Success
    // ==============================
    if (result.ok) {
      await ctx.reply(
        `${pe(PE.check, '✅')} <b>Package ဝယ်ယူမှု အောင်မြင်ပါသည်!</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.kiki, '📦')} <b>${pack.name}</b>\n` +
        `${pe(PE.notification, '📝')} ${pack.desc}\n` +
        `${pe(PE.chart, '📅')} သက်တမ်း: <b>${pack.days}</b>\n` +
        `${pe(PE.balance, '💰')} စျေးနှုန်း: <b>${Number(pack.price).toLocaleString()} ${pack.unit}</b>\n` +
        `${pe(PE.notification, '🔖')} Code: <code>${pack.id}</code>\n\n` +
        `${pe(PE.check, '✅')} ${result.message}`,
        {
          parse_mode: 'HTML',
        }
      );
    }

    // ==============================
    // Purchase Failed
    // ==============================
    else {
      await ctx.reply(
        `${pe(PE.notification, '❌')} <b>ဝယ်ယူမှု မအောင်မြင်ပါ</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.kiki, '📦')} <b>${pack.name}</b>\n` +
        `${pe(PE.balance, '💰')} စျေးနှုန်း: <b>${Number(pack.price).toLocaleString()} ${pack.unit}</b>\n\n` +
        `${pe(PE.notification, '⚠️')} အကြောင်းရင်း:\n` +
        `<code>${result.message || 'မသိရှိရသေးပါ။'}</code>`,
        {
          parse_mode: 'HTML',
        }
      );
    }
  } catch (e: any) {
    console.error('vas:confirm error:', e);

    await ctx.telegram
      .deleteMessage(ctx.chat!.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>Package ဝယ်ယူရာတွင် Error ဖြစ်နေပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါ။\n\n` +
      `<code>${e?.message || e}</code>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});


// ==================== POINT HISTORY (ရရှိသော / သုံးစွဲသော) ====================
function formatPointHistoryList(
  type: 'EARN' | 'BURN',
  items: Array<{
    reason: string;
    amount: string;
    time: string;
  }>
): string {
  const title =
    type === 'EARN'
      ? 'ရရှိသော ပွိုင့် (EARN)'
      : 'သုံးစွဲသော ပွိုင့် (BURN)';

  const sign = type === 'EARN' ? '+' : '-';

  const titleEmoji =
    type === 'EARN'
      ? PE.check
      : PE.notification;

  if (!items.length) {
    return (
      `${pe(PE.myid, '📜')} <b>Point History</b>\n` +
      `════════════════════\n\n` +
      `${pe(titleEmoji, type === 'EARN' ? '📗' : '📕')} ` +
      `<b>${title}</b>\n\n` +
      `${pe(PE.notification, '📭')} မှတ်တမ်း မရှိပါ။`
    );
  }

  let text =
    `${pe(PE.myid, '📜')} <b>Point History</b>\n` +
    `════════════════════\n\n` +
    `${pe(titleEmoji, type === 'EARN' ? '📗' : '📕')} ` +
    `<b>${title}</b>\n` +
    `${pe(PE.notification, '📋')} <i>နောက်ဆုံး ${Math.min(items.length, 20)} ခု</i>\n\n`;

  for (const it of items.slice(0, 20)) {
    text +=
      `${pe(
        type === 'EARN' ? PE.check : PE.notification,
        type === 'EARN' ? '➕' : '➖'
      )} ` +
      `<b>${sign}${it.amount}</b> — ${it.reason}\n` +
      `  ${pe(PE.chart, '🕐')} <i>${it.time || '—'}</i>\n`;
  }

  if (items.length > 20) {
    text +=
      `\n${pe(PE.notification, '📋')} ` +
      `<i>… +${items.length - 20} more</i>`;
  }

  return text;
}


// ==========================================
// Point History Keyboard
// ==========================================
const pointHistoryKeyboard = (
  active: 'EARN' | 'BURN'
) => ({
  inline_keyboard: [
    [
      {
        text:
          active === 'EARN'
            ? 'ရရှိသောပွိုင့်'
            : 'ရရှိသောပွိုင့်',
        callback_data: 'ph:EARN',
        style:
          active === 'EARN'
            ? 'primary'
            : 'success',
        icon_custom_emoji_id:
          active === 'EARN'
            ? PE.check
            : PE.chart,
      },
      {
        text:
          active === 'BURN'
            ? 'သုံးစွဲသောပွိုင့်'
            : 'သုံးစွဲသောပွိုင့်',
        callback_data: 'ph:BURN',
        style:
          active === 'BURN'
            ? 'primary'
            : 'success',
        icon_custom_emoji_id:
          active === 'BURN'
            ? PE.check
            : PE.notification,
      },
    ],
    [
      {
        text: 'Refresh',
        callback_data: `ph:${active}`,
        style: 'primary',
        icon_custom_emoji_id: PE.loading,
      },
    ],
  ],
});


// ==========================================
// Point History
// ==========================================
bot.hears('📜 Point History', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  // ========================================
  // MYTEL Login Check
  // ========================================
  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);

    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
        ...kb,
      }
    );
  }

  // ========================================
  // Loading
  // ========================================
  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Point History ရယူနေပါတယ်...</b>`,
    {
      parse_mode: 'HTML',
    }
  );

  try {
    const result =
      await MyIdService.getPointHistory(
        sess,
        'EARN'
      );

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        wait.message_id
      )
      .catch(() => {});

    // ======================================
    // API Error
    // ======================================
    if (!result.ok) {
      return ctx.reply(
        `${pe(PE.notification, '⚠️')} <b>Point History</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.notification, '📋')} ` +
        `${result.message || 'မရရှိပါ။'}`,
        {
          parse_mode: 'HTML',
          reply_markup:
            pointHistoryKeyboard('EARN'),
        }
      );
    }

    // ======================================
    // History Result
    // ======================================
    await ctx.reply(
      formatPointHistoryList(
        'EARN',
        result.items
      ),
      {
        parse_mode: 'HTML',
        reply_markup:
          pointHistoryKeyboard('EARN'),
      }
    );
  } catch (e: any) {
    console.error(
      'Point History error:',
      e
    );

    await ctx.telegram
      .deleteMessage(
        ctx.chat.id,
        wait.message_id
      )
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} ` +
      `<b>Point History ရယူရာတွင် Error ဖြစ်နေပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါ။\n\n` +
      `<code>${e?.message || e}</code>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});


// ==========================================
// EARN / BURN / REFRESH
// ==========================================
bot.action(/^ph:(EARN|BURN)$/, async (ctx) => {
  await ctx.answerCbQuery(
    '⏳ Loading...'
  ).catch(() => {});

  const type =
    ctx.match[1] as 'EARN' | 'BURN';

  const sess =
    await getMyIdSession(ctx.from!.id);

  // ========================================
  // MYTEL Login Check
  // ========================================
  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  try {
    const result =
      await MyIdService.getPointHistory(
        sess,
        type
      );

    const text = result.ok
      ? formatPointHistoryList(
          type,
          result.items
        )
      : (
          `${pe(PE.notification, '⚠️')} ` +
          `<b>Point History</b>\n` +
          `════════════════════\n\n` +
          `${result.message || 'မရရှိပါ။'}`
        );

    await ctx
      .editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup:
          pointHistoryKeyboard(type),
      })
      .catch(async () => {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup:
            pointHistoryKeyboard(type),
        });
      });
  } catch (e: any) {
    console.error(
      'Point History action error:',
      e
    );

    await ctx.reply(
      `${pe(PE.notification, '❌')} ` +
      `<b>Point History ရယူရာတွင် Error ဖြစ်နေပါတယ်။</b>\n\n` +
      `<code>${e?.message || e}</code>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});


// ==================== ACCESS TOKEN LOGIN ====================
const pendingTokenLogin = new Set<number>();

bot.hears(['🔑 Access Token Login', '🔑 Token Login'], async (ctx) => {
  pendingTokenLogin.add(ctx.from.id);
  await ctx.reply(
    `${pe(PE.myid, '🔑')} <b>Access Token Login</b>\n\n` +
    `MyID Access Token (access_token) ကို ဒီ chat ထဲ ပို့ပေးပါ။\n\n` +
    `<i>OTP မလိုဘဲ token ဖြင့် တိုက်ရိုက် login ဝင်နိုင်ပါတယ်။</i>\n` +
    `မလုပ်လိုပါက /cancel ရိုက်ပါ။`,
    { parse_mode: 'HTML' }
  );
});

// Also support old login button text for OTP scene entry - keep existing hears

// Capture token text when waiting
bot.on('text', async (ctx, next) => {
  const uid = ctx.from?.id;
  if (!uid || !pendingTokenLogin.has(uid)) return next();

  const text = String((ctx.message as any)?.text || '').trim();
  if (!text) return next();

  if (text === '/cancel' || text.startsWith('/')) {
    pendingTokenLogin.delete(uid);
    if (text === '/cancel') {
      await ctx.reply('❌ Token login ပယ်ဖျက်လိုက်ပါပြီ။', { parse_mode: 'HTML' });
      return;
    }
    return next();
  }

  // Ignore if it looks like a menu button
  if (
    text.includes('Data') ||
    text.includes('Point') ||
    text.includes('Package') ||
    text.includes('OU Game') ||
    text.includes('Login') ||
    text.includes('ပင်မ')
  ) {
    pendingTokenLogin.delete(uid);
    return next();
  }

  pendingTokenLogin.delete(uid);
  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Access Token စစ်ဆေးနေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const token = text.replace(/^Bearer\s+/i, '').trim();
    const session = await MyIdService.loginWithAccessToken(token);
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (!session) {
      return ctx.reply(
        `${pe(PE.notification, '❌')} <b>Token မမှန်ကန်ပါ / သက်တမ်းကုန်နေပါတယ်။</b>\n\n` +
        `Token အသစ်ယူပြီး ပြန်စမ်းပါ။`,
        { parse_mode: 'HTML' }
      );
    }

    await saveMyIdSession(uid, session);
    const kb = getMytelReplyKeyboard(true);
    await ctx.reply(
      `${pe(PE.check, '✅')} <b>Access Token Login အောင်မြင်ပါသည်!</b>\n\n` +
      `📱 Phone: <code>${session.phone}</code>\n` +
      (session.full_name ? `👤 ${session.full_name}\n` : '') +
      `\nအောက်က ခလုတ်များသုံးပါ။`,
      { parse_mode: 'HTML', ...kb }
    );
  } catch (e: any) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ Error: ${e?.message || e}`, { parse_mode: 'HTML' }).catch(() => {});
  }
});


// Data / Voice / SMS detail popups
bot.action('bal:raw', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const sess = await getMyIdSession(ctx.from!.id);
  if (!sess) return ctx.reply('❌ MYTEL Login လိုအပ်ပါတယ်။');
  const wait = await ctx.reply('⏳ Raw response ရယူနေပါတယ်...');
  try {
    const info = await MyIdService.getLoyaltyAccountInfo(sess);
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});
    const raw = JSON.stringify(info.raw ?? { message: 'no raw' }, null, 2);
    // Telegram message limit ~4096
    const chunk = raw.length > 3500 ? raw.slice(0, 3500) + '\n…(truncated)' : raw;
    await ctx.reply(
      `${pe(PE.myid, '🔎')} <b>Account API Raw</b>\n\n<code>${chunk
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (e: any) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${e?.message || e}`).catch(() => {});
  }
});

bot.action(/^bal:details:(data|voice|sms)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const kind = ctx.match[1] as 'data' | 'voice' | 'sms';
  const sess = await getMyIdSession(ctx.from!.id);
  if (!sess) {
    return ctx.reply('❌ MYTEL Login လိုအပ်ပါတယ်။');
  }

  const wait = await ctx.reply('⏳ Details ရယူနေပါတယ်...');
  try {
    const info = await MyIdService.getLoyaltyAccountInfo(sess);
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});

    const details =
      kind === 'data'
        ? info.dataDetails
        : kind === 'voice'
          ? info.voiceDetails
          : info.smsDetails;

    const title =
      kind === 'data' ? '📶 Data သက်တမ်း' : kind === 'voice' ? '📞 Voice သက်တမ်း' : '💬 SMS သက်တမ်း';

    if (!details?.length) {
      return ctx.reply(`${title}\n\n📭 Detail မရှိပါ။`, { parse_mode: 'HTML' });
    }

    let text = `${pe(PE.myid, '📋')} <b>${title}</b>\n════════════════════\n\n`;
    for (const d of details.slice(0, 30)) {
      const amt =
        kind === 'data' ? MyIdService.formatDataAmount(d.amount) : d.amount;
      text += `• <b>${d.name}</b>\n  📦 ${amt}\n  ⏰ သက်တမ်း: <code>${d.expiry}</code>\n\n`;
    }
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (e: any) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ ${e?.message || e}`).catch(() => {});
  }
});


// ==================== OU GAME SUBMENU ====================
bot.hears(['😎 Ou Game ဆော့မယ်', '😎Ou Game ဆော့မယ်'], async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);
  if (!sess) {
    return ctx.reply('❌ အရင် MYTEL Login လုပ်ပေးပါ။', {
      parse_mode: 'HTML',
      ...getMytelReplyKeyboard(false),
    });
  }
  await ctx.reply(
    `${pe(PE.myid, '🎮')} <b>OU Game Menu</b>\n\n` +
    `အောက်က ခလုတ်များသုံးပါ။\n` +
    `<i>◀️ နောက်သို့ = MYTEL main menu</i>`,
    { parse_mode: 'HTML', ...getOuGameKeyboard() }
  );
});

bot.hears('◀️ နောက်သို့', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);
  if (!sess) {
    return ctx.reply('MYTEL Menu', { ...getMytelReplyKeyboard(false) });
  }
  await ctx.reply(
    `${pe(PE.myid, '🟠')} <b>MYTEL Menu</b>`,
    { parse_mode: 'HTML', ...getMytelReplyKeyboard(true) }
  );
});


// ==================== PIRATE WAR ====================
// MyID login ရှိပြီးသား → သီးသန့် Pirate login မလို — auto-connect
bot.hears(
  ['⛵ Pirate War ဆော့မယ်', '⛵Pirate War ဆော့မယ်'],
  async (ctx) => {
    const sess = await getMyIdSession(ctx.from.id);

    if (!sess) {
      return ctx.reply(
        `${pe(PE.myid, '❌')} <b>အရင် MYTEL Login လုပ်ပေးပါ။</b>`,
        {
          parse_mode: 'HTML',
          ...getMytelReplyKeyboard(false),
        }
      );
    }

    let pirate = await ensurePirateSession(ctx.from.id, sess);

    if (!pirate) {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>ခဏစောင့်ပါ...</b>`,
        { parse_mode: 'HTML' }
      );

      try {
        pirate = await ensurePirateSession(
          ctx.from.id,
          sess,
          true
        );

        await ctx.telegram
          .deleteMessage(ctx.chat.id, wait.message_id)
          .catch(() => {});
      } catch (e: any) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, wait.message_id)
          .catch(() => {});

        return ctx.reply(
          `${pe(PE.notification, '❌')} <b>${e?.message || e}</b>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    if (!pirate) {
      return ctx.reply(
        `${pe(PE.notification, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
        `${pe(PE.myid, '📱')} MyID token သက်တမ်းကုန်နေနိုင်ပါတယ်။\n` +
        `<b>MYTEL Logout</b> ပြီး ပြန် Login လုပ်ပါ။`,
        {
          parse_mode: 'HTML',
          ...getMytelReplyKeyboard(true),
        }
      );
    }

    await ctx.reply(
      `${pe(PE.kiki, '⛵')} <b>Pirate War</b>\n` +
      `════════════════════\n\n` +
      `${pe(PE.check, '✅')} MyID နဲ့ အလိုအလျောက် ချိတ်ပြီးပါပြီ။\n\n` +
      `${pe(PE.notification, '📋')} အောက်က ခလုတ်များကို အသုံးပြုပါ။`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }
);


// ============================================================
// Pirate Profile
// ============================================================

bot.hears('👤 Pirate Profile', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Profile ရယူနေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const pirate = await ensurePirateSession(ctx.from.id, sess);

    if (!pirate) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, wait.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.notification, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
        `MYTEL ပြန် Login လုပ်ပေးပါ။`,
        { parse_mode: 'HTML' }
      );
    }

    const prof = await PirateWarService.getProfile(
      pirate.gameToken
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    if (!prof.ok) {
      return ctx.reply(
        `${pe(PE.notification, '❌')} <b>${prof.message}</b>`,
        {
          parse_mode: 'HTML',
          ...getPirateWarKeyboard(),
        }
      );
    }

    await ctx.reply(
      `${pe(PE.userId, '👤')} <b>Pirate Profile</b>\n` +
      `════════════════════\n\n` +
      `${prof.text || 'Profile မရရှိပါ။'}`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  } catch (e: any) {
    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>${e?.message || e}</b>`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }
});


// ============================================================
// Auto Battle
// ============================================================

bot.hears('⚔️ Auto Battle', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  }

  const pirate = await ensurePirateSession(ctx.from.id, sess);

  if (!pirate) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
      `MYTEL ပြန် Login လုပ်ပေးပါ။`,
      { parse_mode: 'HTML' }
    );
  }

  pirateStopFlags.set(ctx.from.id, false);

  await ctx.reply(
    `${pe(PE.kiki, '⚔️')} <b>Auto Battle စတင်ပါပြီ</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.chart, '🎮')} Level <b>1 → 15</b>\n\n` +
    `${pe(PE.notification, '🛑')} ရပ်ချင်ရင် <b>🛑 ရပ်မယ်</b> ကို နှိပ်ပါ။`,
    {
      parse_mode: 'HTML',
      ...getPirateWarKeyboard(true),
    }
  );

  const status = await ctx.reply(
    `${pe(PE.loading, '⚔️')} <b>Battle log...</b>\n\n` +
    `ခဏစောင့်ပါ။`,
    { parse_mode: 'HTML' }
  );

  try {
    const liveLogs: string[] = [];
    let lastEdit = Date.now();

    const result = await PirateWarService.autoBattle(
      pirate.gameToken,
      15,
      async (msg) => {
        liveLogs.push(msg);

        if (Date.now() - lastEdit < 1500) return;

        lastEdit = Date.now();

        const tail = liveLogs
          .slice(-8)
          .join('\n')
          .slice(0, 3500);

        await ctx.telegram
          .editMessageText(
            ctx.chat!.id,
            status.message_id,
            undefined,
            `${pe(PE.kiki, '⚔️')} <b>Auto Battle</b>\n\n` +
            `${tail}`,
            {
              parse_mode: 'HTML',
            }
          )
          .catch(() => {});
      },
      () => pirateStopFlags.get(ctx.from.id) === true
    );

    pirateStopFlags.set(ctx.from.id, false);

    const title = result.stopped
      ? `${pe(PE.notification, '🛑')} Auto Battle ရပ်လိုက်ပါပြီ`
      : `${pe(PE.check, '⛵')} Auto Battle ပြီးပါပြီ`;

    const summary =
      `<b>${title}</b>\n` +
      `════════════════════\n\n` +
      `${pe(PE.check, '✅')} Win: <b>${result.win}</b>\n` +
      `${pe(PE.notification, '❌')} Fail: <b>${result.fail}</b>\n\n` +
      `${result.logs
        .slice(-12)
        .join('\n')
        .slice(0, 3000)}`;

    await ctx.telegram
      .editMessageText(
        ctx.chat!.id,
        status.message_id,
        undefined,
        summary,
        {
          parse_mode: 'HTML',
        }
      )
      .catch(async () => {
        await ctx.reply(summary, {
          parse_mode: 'HTML',
        });
      });

    await ctx.reply(
      `${pe(PE.kiki, '⛵')} <b>Pirate War Menu</b>`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(false),
      }
    );
  } catch (e: any) {
    pirateStopFlags.set(ctx.from.id, false);

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>Battle Error</b>\n\n` +
      `${e?.message || e}`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(false),
      }
    );
  }
});


// ============================================================
// Stop Auto Battle
// ============================================================

bot.hears(
  ['🛑 ရပ်မယ်', '🛑 ရပ်မည်', 'ရပ်မယ်'],
  async (ctx) => {
    pirateStopFlags.set(ctx.from.id, true);

    await ctx.reply(
      `${pe(PE.notification, '🛑')} <b>ရပ်ရန် တောင်းဆိုလိုက်ပါပြီ</b>\n\n` +
      `${pe(PE.loading, '⏳')} လက်ရှိ Level ပြီးရင် Auto Battle ရပ်ပါမယ်...`,
      {
        parse_mode: 'HTML',
      }
    );
  }
);


// ============================================================
// Lucky Spin
// ============================================================

bot.hears('🎰 Lucky Spin', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  }

  const pirate = await ensurePirateSession(ctx.from.id, sess);

  if (!pirate) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
      `MYTEL ပြန် Login လုပ်ပေးပါ။`,
      { parse_mode: 'HTML' }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '🎰')} <b>Lucky Spin လုပ်နေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const r = await PirateWarService.spin(
      pirate.gameToken,
      1
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      r.ok
        ? `${pe(PE.check, '✅')} ${r.message}`
        : `${pe(PE.notification, '❌')} ${r.message}`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  } catch (e: any) {
    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} <b>${e?.message || e}</b>`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }
});


// ============================================================
// Pirate Exchange
// ============================================================

bot.hears('🔄 Pirate Exchange', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  }

  const pirate = await ensurePirateSession(ctx.from.id, sess);

  if (!pirate) {
    return ctx.reply(
      `${pe(PE.notification, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
      `MYTEL ပြန် Login လုပ်ပေးပါ။`,
      { parse_mode: 'HTML' }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Exchange list ရယူနေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const list = await PirateWarService.exchangeList(
      pirate.gameToken
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    if (!list.ok || !list.packs.length) {
      return ctx.reply(
        `${pe(PE.x, '❌')} <b>${list.message || 'Pack မရှိပါ'}</b>`,
        {
          parse_mode: 'HTML',
          ...getPirateWarKeyboard(),
        }
      );
    }

    let text =
      `${pe(PE.kiki, '🔄')} <b>Pirate Exchange</b>\n` +
      `════════════════════\n\n` +
      `${pe(PE.chart, '🪨')} Stones: <b>${list.stones}</b>\n\n`;

    const rows: any[] = [];

    list.packs
      .slice(0, 20)
      .forEach((p, i) => {
        const name =
          p.dataCode ||
          (p.receivePVF
            ? p.receivePVF + ' Diamond'
            : 'Pack ' + (i + 1));

        const cost =
          `${pe(PE.balance, '💰')}${(p.requiredPVG || 0).toLocaleString()}` +
          ` · ` +
          `${pe(PE.chart, '🪨')}${p.requiredEnergyStone || 0}`;

        text +=
          `<b>${i + 1}. ${name}</b>\n` +
          `   ${cost}\n`;

        rows.push([
          {
            text: `${i + 1}. ${String(name).slice(0, 28)}`,
            callback_data: `pw:ex:${p.id}`,
            style: 'primary',
            icon_custom_emoji_id: PE.kiki,
          },
        ]);
      });

    // Store packs temporarily on session object
    (pirate as any)._exchangePacks = list.packs;

    pirateSessions.set(ctx.from.id, pirate);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: rows.slice(0, 15),
      },
    });
  } catch (e: any) {
    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.x, '❌')} <b>${e?.message || e}</b>`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }
});


// ============================================================
// Pirate Exchange Action
// ============================================================

bot.action(/^pw:ex:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Exchanging...').catch(() => {});

  const packId = ctx.match[1];

  const sess = await getMyIdSession(ctx.from!.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const pirate = await ensurePirateSession(
    ctx.from!.id,
    sess
  );

  if (!pirate) {
    return ctx.reply(
      `${pe(PE.x, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
      `MYTEL ပြန် Login လုပ်ပေးပါ။`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const packs = (pirate as any)._exchangePacks || [];

  const pack = packs.find(
    (p: any) => String(p.id) === String(packId)
  );

  if (!pack) {
    const r = await PirateWarService.doExchange(
      pirate.gameToken,
      {
        id: packId,
        dataCode: 'x',
      }
    );

    return ctx.reply(
      r.ok
        ? `${pe(PE.check, '✅')} ${r.message}`
        : `${pe(PE.x, '❌')} ${r.message}`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }

  const r = await PirateWarService.doExchange(
    pirate.gameToken,
    pack
  );

  await ctx.reply(
    r.ok
      ? `${pe(PE.check, '✅')} ${r.message}`
      : `${pe(PE.x, '❌')} ${r.message}`,
    {
      parse_mode: 'HTML',
      ...getPirateWarKeyboard(),
    }
  );
});


// ============================================================
// Buy Energy
// ============================================================

bot.hears('⚡ Buy Energy', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.x, '❌')} <b>MYTEL Login လိုအပ်ပါတယ်။</b>`,
      {
        parse_mode: 'HTML',
        ...getMytelReplyKeyboard(false),
      }
    );
  }

  const pirate = await ensurePirateSession(ctx.from.id, sess);

  if (!pirate) {
    return ctx.reply(
      `${pe(PE.x, '❌')} <b>Pirate War ချိတ်ဆက်မရပါ။</b>\n\n` +
      `MYTEL ပြန် Login လုပ်ပေးပါ။`,
      { parse_mode: 'HTML' }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Energy ဝယ်နေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const r = await PirateWarService.buyEnergy(
      pirate.gameToken
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      r.ok
        ? `${pe(PE.check, '✅')} ${r.message}`
        : `${pe(PE.x, '❌')} ${r.message}`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  } catch (e: any) {
    await ctx.telegram
      .deleteMessage(ctx.chat.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.x, '❌')} <b>${e?.message || e}</b>`,
      {
        parse_mode: 'HTML',
        ...getPirateWarKeyboard(),
      }
    );
  }
});


// ==================== DAILY CLAIM (daily-quest) ====================
bot.hears('🎁 Daily Claim', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);
  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      { parse_mode: 'HTML', ...kb }
    );
  }

  const wait = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>Daily Claim လုပ်နေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    // Try common reward codes used by daily-quest
    const codes = ['DAILY_CLAIM', 'DAILY', 'CLAIM', 'daily_claim', '1'];
    let lastResult: { ok: boolean; message: string; raw?: any } | null = null;
    let success: { ok: boolean; message: string; raw?: any } | null = null;

    for (const code of codes) {
      lastResult = await MyIdService.dailyQuestClaim(sess, code);
      if (lastResult.ok) {
        success = lastResult;
        break;
      }
      // if already claimed / invalid code, continue trying next
      await new Promise((r) => setTimeout(r, 400));
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});

    if (success?.ok) {
      await ctx.reply(
        `${pe(PE.check, '✅')} <b>Daily Claim အောင်မြင်ပါသည်!</b>\n\n` +
        `${success.message}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `${pe(PE.notification, '⚠️')} <b>Daily Claim</b>\n\n` +
        `${lastResult?.message || 'မအောင်မြင်ပါ။'}\n\n` +
        `<i>ယနေ့ claim ပြီးသား ဖြစ်နိုင်ပါတယ်။</i>`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (e: any) {
    await ctx.telegram.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
    await ctx.reply(`❌ Error: ${e?.message || e}`, { parse_mode: 'HTML' }).catch(() => {});
  }
});


// ==================== NETWORK TEST ====================
bot.hears('📡 Network Test', async (ctx) => {
  const sess = await getMyIdSession(ctx.from.id);

  if (!sess) {
    const kb = await getMainKeyboardForUser(ctx.from.id);

    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>အရင်ဆုံး MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
        ...kb,
      }
    );
  }

  await ctx.reply(
    `${pe(PE.myid, '📡')} <b>Network Test</b>\n` +
    `════════════════════\n\n` +
    `${pe(PE.notification, '📋')} Operator ရွေးပါ (သို့) အားလုံး တစ်ခါတည်း submit လုပ်နိုင်ပါတယ်။\n` +
    `${pe(PE.chart, '⭐')} <i>Point ရရှိနိုင်ပါတယ်။</i>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'ATOM',
              callback_data: 'nt:ATOM',
              style: 'primary',
              icon_custom_emoji_id: PE.atom,
            },
            {
              text: 'MYTEL',
              callback_data: 'nt:MYTEL',
              style: 'primary',
              icon_custom_emoji_id: PE.myid,
            },
          ],
          [
            {
              text: 'OOREDOO',
              callback_data: 'nt:OOREDOO',
              style: 'success',
              icon_custom_emoji_id: PE.notification,
            },
            {
              text: 'MPT',
              callback_data: 'nt:MPT',
              style: 'success',
              icon_custom_emoji_id: PE.kiki,
            },
          ],
          [
            {
              text: 'အားလုံး Submit',
              callback_data: 'nt:ALL',
              style: 'primary',
              icon_custom_emoji_id: PE.check,
            },
          ],
        ],
      },
    }
  );
});

bot.action(/^nt:(ATOM|MYTEL|OOREDOO|MPT|ALL)$/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Submitting...').catch(() => {});

  const which = ctx.match[1];

  const sess = await getMyIdSession(ctx.from!.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.myid, '❌')} <b>MYTEL Login လုပ်ပေးပါ။</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  }

  const wait = await ctx.reply(
    which === 'ALL'
      ? `${pe(PE.loading, '⏳')} <b>ATOM / MYTEL / OOREDOO / MPT</b> submit လုပ်နေပါတယ်...`
      : `${pe(PE.loading, '⏳')} <b>${which}</b> Network Test submit လုပ်နေပါတယ်...`,
    {
      parse_mode: 'HTML',
    }
  );

  try {
    if (which === 'ALL') {
      const { results } =
        await MyIdService.submitAllNetworkTests(sess);

      await ctx.telegram
        .deleteMessage(ctx.chat!.id, wait.message_id)
        .catch(() => {});

      let text =
        `${pe(PE.myid, '📡')} <b>Network Test ရလဒ်</b>\n` +
        `════════════════════\n\n`;

      let okCount = 0;

      for (const r of results) {
        text += r.ok
          ? `${pe(PE.check, '✅')} <b>${r.operator}</b> — ${r.message}\n`
          : `${pe(PE.notification, '❌')} <b>${r.operator}</b> — ${r.message}\n`;

        if (r.ok) okCount++;
      }

      text +=
        `\n${pe(PE.chart, '📊')} <b>စုစုပေါင်း:</b> ` +
        `<b>${okCount}/${results.length}</b> အောင်မြင်`;

      await ctx.reply(text, {
        parse_mode: 'HTML',
      });

    } else {
      const result =
        await MyIdService.submitNetworkTest(
          sess,
          which as
            | 'ATOM'
            | 'MYTEL'
            | 'OOREDOO'
            | 'MPT'
        );

      await ctx.telegram
        .deleteMessage(ctx.chat!.id, wait.message_id)
        .catch(() => {});

      if (result.ok) {
        await ctx.reply(
          `${pe(PE.check, '✅')} ` +
          `<b>${result.operator} Network Test အောင်မြင်</b>\n\n` +
          `${result.message}`,
          {
            parse_mode: 'HTML',
          }
        );
      } else {
        await ctx.reply(
          `${pe(PE.notification, '❌')} ` +
          `<b>${result.operator}</b>\n\n` +
          `${result.message}`,
          {
            parse_mode: 'HTML',
          }
        );
      }
    }

  } catch (e: any) {
    console.error('Network Test error:', e);

    await ctx.telegram
      .deleteMessage(ctx.chat!.id, wait.message_id)
      .catch(() => {});

    await ctx.reply(
      `${pe(PE.notification, '❌')} ` +
      `<b>Network Test လုပ်ရာတွင် Error ဖြစ်နေပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါ။\n\n` +
      `<code>${e?.message || e}</code>`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});


// ==================== MYTEL DAILY ====================
bot.hears('🎁 MYTEL Daily', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>Daily Reward ရယူနေပါတယ်...</b>`,
        { parse_mode: 'HTML' }
      );

      const result = await MyIdService.claimDaily(token);

      await ctx.telegram
        .deleteMessage(ctx.chat.id, wait.message_id)
        .catch(() => {});

      await ctx.reply(
        `${pe(PE.check, '🎁')} <b>MYTEL Daily</b>\n\n${result || 'လုပ်ဆောင်ပြီးပါပြီ။'}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('MYTEL Daily error:', error);

      await ctx.reply(
        `${pe(PE.notification, '❌')} Daily Reward ရယူရာတွင် အခက်အခဲရှိနေပါတယ်။`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
});


// ==================== MYTEL PROFILE ====================
bot.hears('👤 MYTEL Profile', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>Profile ရယူနေပါတယ်...</b>`,
        { parse_mode: 'HTML' }
      );

      const profile = await MyIdService.getProfile(token);

      await ctx.telegram
        .deleteMessage(ctx.chat.id, wait.message_id)
        .catch(() => {});

      await ctx.reply(
        `${pe(PE.userId, '👤')} <b>MYTEL Profile</b>\n\n` +
        `${profile || '❌ Profile ယူမရပါ။'}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('MYTEL Profile error:', error);

      await ctx.reply(
        `${pe(PE.notification, '❌')} Profile ရယူရာတွင် အခက်အခဲရှိနေပါတယ်။`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
});


// ==================== MYTEL TURNS ====================
bot.hears('🎫 MYTEL Turns', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const turns = await MyIdService.getTurns(token);

      const free = Number(turns?.free ?? 0);
      const paid = Number(turns?.paid ?? 0);
      const total = Number(turns?.total ?? 0);

      await ctx.reply(
        `${pe(PE.myid, '🎫')} <b>MYTEL Turns</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.check, '🎫')} Free Turns: <b>${free.toLocaleString()}</b>\n` +
        `${pe(PE.balance, '🎫')} Paid Turns: <b>${paid.toLocaleString()}</b>\n` +
        `${pe(PE.chart, '🎫')} Total: <b>${total.toLocaleString()}</b>`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      console.error('MYTEL Turns error:', error);

      await ctx.reply(
        `${pe(PE.notification, '❌')} Turns စစ်ဆေးရာတွင် အခက်အခဲရှိနေပါတယ်။`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
});


// ==================== OU GAME SELECT ====================
bot.hears('🎮 OU Game ဆော့ရန်', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const turns = await MyIdService.getTurns(token);

      const totalTurns = Number(turns?.total ?? 0);

      if (totalTurns <= 0) {
        return ctx.reply(
          `${pe(PE.notification, '❌')} <b>ကစားခွင့် (Turns) မရှိတော့ပါ။</b>\n\n` +
          `${pe(PE.check, '🎁')} Daily Reward သို့မဟုတ် Store မှ ဝယ်ယူနိုင်ပါတယ်။`,
          { parse_mode: 'HTML' }
        );
      }

      // Maximum 5 rounds per request
      const maxRounds = Math.min(totalTurns, 5);

      const buttons = [];

      for (let i = 1; i <= maxRounds; i++) {
        buttons.push(
          Markup.button.callback(
            `${i} ပွဲ`,
            `myid_play_${i}`
          )
        );
      }

      await ctx.reply(
        `${pe(PE.myid, '🎮')} <b>OU Game</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.check, '🎫')} လက်ကျန် Turns: <b>${totalTurns.toLocaleString()}</b>\n\n` +
        `${pe(PE.notification, '🎮')} ဘယ်နှစ်ပွဲ ကစားမလဲ?\n` +
        `<i>အများဆုံး ${maxRounds} ပွဲ</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard(buttons, {
            columns: 5,
          }).reply_markup,
        }
      );
    } catch (error) {
      console.error('OU Game select error:', error);

      await ctx.reply(
        `${pe(PE.notification, '❌')} Game Turns ရယူရာတွင် အခက်အခဲရှိနေပါတယ်။`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
});


// ==================== OU GAME PLAY ====================
bot.action(/myid_play_(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery().catch(() => {});

    const rounds = Number(
      (ctx.match as RegExpMatchArray)?.[1] ?? 0
    );

    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
      return ctx.reply(
        `${pe(PE.notification, '❌')} <b>Game အရေအတွက် မမှန်ကန်ပါ။</b>`,
        { parse_mode: 'HTML' }
      );
    }

    await withMyIdToken(ctx, async (token) => {
      try {
        const progressMsg = await ctx.reply(
          `${pe(PE.loading, '🎮')} <b>${rounds} ပွဲ စတင်နေပါတယ်...</b>`,
          { parse_mode: 'HTML' }
        );

        let grandTotal = 0;
        const allRewards: string[] = [];

        for (let r = 1; r <= rounds; r++) {
          const { rewards, total } = await MyIdService.playRound(
            token,
            r,
            async (txt) => {
              await ctx.telegram
                .editMessageText(
                  ctx.chat!.id,
                  progressMsg.message_id,
                  undefined,
                  `${pe(PE.loading, '🎮')} <b>Round ${r}/${rounds}</b>\n\n${txt}`,
                  { parse_mode: 'HTML' }
                )
                .catch(() => {});
            }
          );

          grandTotal += Number(total ?? 0);

          if (Array.isArray(rewards)) {
            allRewards.push(
              ...rewards.map(
                (x) => `R${r}: ${String(x)}`
              )
            );
          }
        }

        let summary =
          `${pe(PE.check, '✅')} <b>Game ပြီးဆုံးပါပြီ!</b>\n` +
          `════════════════════\n\n` +
          `🍈 <b>စုစုပေါင်း Jackfruit:</b> +${grandTotal.toLocaleString()}\n\n`;

        if (allRewards.length > 0) {
          summary += allRewards.slice(0, 20).join('\n');

          if (allRewards.length > 20) {
            summary += `\n\n... +${allRewards.length - 20} more`;
          }
        } else {
          summary += `${pe(PE.notification, '📭')} Reward မရှိပါ။`;
        }

        await ctx.telegram
          .editMessageText(
            ctx.chat!.id,
            progressMsg.message_id,
            undefined,
            summary,
            { parse_mode: 'HTML' }
          )
          .catch(() => ctx.reply(summary, { parse_mode: 'HTML' }));
      } catch (error) {
        console.error('OU Game play error:', error);

        await ctx.reply(
          `${pe(PE.notification, '❌')} <b>Game ကစားနေစဉ် အခက်အခဲဖြစ်သွားပါတယ်။</b>\n\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါ။`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    });
  } catch (error) {
    console.error('myid_play callback error:', error);

    await ctx.reply(
      `${pe(PE.notification, '❌')} လုပ်ဆောင်ရာတွင် အခက်အခဲရှိနေပါတယ်။`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});


// ==================== MYTEL STORE (full from Python bot) ====================
bot.hears('🛒 MYTEL Store', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>Store ဖွင့်နေပါတယ်...</b>`,
        { parse_mode: 'HTML' }
      );
      const categories = await MyIdService.getCategories(token);
      await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});

      if (!categories.length) {
        return ctx.reply('❌ Category မရှိပါ။', { parse_mode: 'HTML' });
      }

      const buttons = categories.slice(0, 8).map((cat: any) => {
        let emoji = '📦';
        const name = String(cat.name || '').toLowerCase();
        if (name.includes('daily')) emoji = '📅';
        else if (name.includes('sub')) emoji = '🔄';
        else if (name.includes('one')) emoji = '🎁';
        return [
          Markup.button.callback(
            `${emoji} ${cat.name || 'Category'}`,
            `myid_store_cat_${cat.id}`
          ),
        ];
      });

      await ctx.reply(
        `${pe(PE.myid, '🛒')} <b>MYTEL Store</b>\n` +
        `════════════════════\n` +
        `Category ရွေးပါ:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons),
        }
      );
    } catch (error) {
      console.error('MYTEL Store error:', error);
      await ctx.reply(`${pe(PE.notification, '❌')} Store ဖွင့်ရာတွင် အခက်အခဲရှိနေပါတယ်။`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });
});

bot.action(/myid_store_cat_(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const categoryId = ctx.match[1];
  await withMyIdToken(ctx, async (token) => {
    try {
      await ctx.editMessageText(`${pe(PE.loading, '⏳')} Items ဖွင့်နေပါတယ်...`, { parse_mode: 'HTML' }).catch(() => {});
      const items = await MyIdService.getCategoryItems(token, categoryId);
      if (!items.length) {
        return ctx.editMessageText('❌ Item မရှိပါ။', {
          reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: 'myid_store_back' }]] },
        });
      }

      const buttons = items.slice(0, 10).map((item: any) => {
        let emoji = '📦';
        const n = String(item.name || '').toLowerCase();
        if (n.includes('hammer')) emoji = '🔨';
        else if (n.includes('mix')) emoji = '🌀';
        else if (n.includes('turn')) emoji = '🎫';
        const price = Number(item.price || 0).toLocaleString();
        return [
          Markup.button.callback(
            `${emoji} ${(item.name || 'Item').slice(0, 20)} - ${price} Ks`,
            `myid_store_buy_${item.id}`
          ),
        ];
      });
      buttons.push([Markup.button.callback('« Back', 'myid_store_back')]);

      await ctx.editMessageText(
        `📦 <b>Items</b>\nရွေးချယ်ပါ:`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
      );
    } catch (error) {
      console.error('Store category error:', error);
      await ctx.editMessageText('❌ Error loading items.').catch(() => {});
    }
  });
});

bot.action(/myid_store_buy_(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const packageId = ctx.match[1];
  await withMyIdToken(ctx, async () => {
    await ctx.editMessageText(
      `╔══════════════════════════════════╗\n` +
      `║        📦 PACKAGE DETAILS        ║\n` +
      `╠══════════════════════════════════╣\n` +
      `║ ⚠️ Charged to MyTel account      ║\n` +
      `╚══════════════════════════════════╝\n\n` +
      `သေချာပါသလား?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, Charge to MyTel', `myid_store_confirm_${packageId}`)],
          [Markup.button.callback('❌ Cancel', 'myid_store_back')],
        ]),
      }
    );
  });
});

bot.action(/myid_store_confirm_(.+)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const packageId = ctx.match[1];
  await withMyIdToken(ctx, async (token) => {
    try {
      await ctx.editMessageText(`${pe(PE.loading, '⏳')} Processing...`, { parse_mode: 'HTML' });
      const result = await MyIdService.buyPackage(token, packageId);
      const code = result?.code ?? '';
      const isSuccess = code === '0' || code === '200' || result?.message === 'Success';

      if (isSuccess) {
        await ctx.editMessageText(
          `✅ <b>Purchase Successful!</b>\n\n` +
          `MyTel account မှ ငွေဖြတ်ပြီးပါပြီ။\n` +
          `Phone မှာ SMS စစ်ပါ။`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.editMessageText(
          `⚠️ <b>Purchase Status</b>\n\n` +
          `SMS ရရင် အောင်မြင်ပါတယ်။\n` +
          `Balance စစ်ပါ။`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🛒 Back to Store', 'myid_store_back')],
            ]),
          }
        );
      }
    } catch (error) {
      console.error('Store confirm error:', error);
      await ctx.editMessageText('❌ Purchase failed.').catch(() => {});
    }
  });
});

bot.action('myid_store_back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageText(
    `${pe(PE.myid, '🛒')} Store ပြန်သွားရန် <b>🛒 MYTEL Store</b> ခလုတ်ကို ပြန်နှိပ်ပါ။`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
});


// ==================== MYTEL HISTORY (full from Python bot) ====================
bot.hears('📋 MYTEL History', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>History ဖွင့်နေပါတယ်...</b>`,
        { parse_mode: 'HTML' }
      );
      const data = await MyIdService.getRewardHistory(token);
      await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});

      if (!data || !Array.isArray(data.data) || data.data.length === 0) {
        return ctx.reply(
          `${pe(PE.notification, '📭')} History မရှိပါ။\nGame ဆော့ပြီးမှ rewards ပေါ်ပါမယ်။`,
          { parse_mode: 'HTML' }
        );
      }

      let text =
        `${pe(PE.myid, '📋')} <b>Reward History</b>\n` +
        `════════════════════\n\n`;

      for (const item of data.data.slice(0, 10)) {
        const name = String(item.reward_name || 'Unknown').slice(0, 20);
        const value = item.value || 0;
        let dateStr = 'N/A';
        if (item.created_at) {
          try {
            dateStr = new Date(item.created_at).toLocaleString('en-GB');
          } catch {}
        }
        let emoji = '🎁';
        const rt = String(item.reward_type || '').toLowerCase();
        if (rt.includes('mix')) emoji = '🌀';
        else if (rt.includes('hammer')) emoji = '🔨';
        else if (rt.includes('turn')) emoji = '🎫';
        else if (rt.includes('diamond')) emoji = '💎';

        text += `${emoji} <b>${name}</b>\n   +${value}  |  ${dateStr}\n\n`;
      }

      const hasNext = data.cursor_metadata?.has_next_page;
      const nextCursor = data.next_cursor || '';
      const buttons = hasNext
        ? [[Markup.button.callback('📜 Load More', `myid_hist_more_${nextCursor}`)]]
        : [];

      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...(buttons.length ? Markup.inlineKeyboard(buttons) : {}),
      });
    } catch (error) {
      console.error('MYTEL History error:', error);
      await ctx.reply(`${pe(PE.notification, '❌')} History ဖွင့်ရာတွင် အခက်အခဲရှိနေပါတယ်။`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });
});

bot.action(/myid_hist_more_(.*)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const cursor = ctx.match[1] || undefined;
  await withMyIdToken(ctx, async (token) => {
    try {
      const data = await MyIdService.getRewardHistory(token, cursor || undefined);
      if (!data?.data?.length) {
        return ctx.reply('No more items.');
      }
      let text = `📋 <b>More History</b>\n\n`;
      for (const item of data.data.slice(0, 10)) {
        text += `🎁 ${String(item.reward_name || '').slice(0, 20)} +${item.value || 0}\n`;
      }
      const hasNext = data.cursor_metadata?.has_next_page;
      const nextCursor = data.next_cursor || '';
      const buttons = hasNext
        ? [[Markup.button.callback('📜 Load More', `myid_hist_more_${nextCursor}`)]]
        : [];
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...(buttons.length ? Markup.inlineKeyboard(buttons) : {}),
      });
    } catch (error) {
      console.error('History more error:', error);
      await ctx.reply('❌ Error.').catch(() => {});
    }
  });
});


// ==================== MYTEL LEADERBOARD ====================
bot.hears('🏆 MYTEL Leaderboard', async (ctx) => {
  await withMyIdToken(ctx, async (token) => {
    try {
      const wait = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>Leaderboard ဖွင့်နေပါတယ်...</b>`,
        { parse_mode: 'HTML' }
      );
      const data = await MyIdService.getLeaderboard(token);
      await ctx.telegram.deleteMessage(ctx.chat!.id, wait.message_id).catch(() => {});

      if (!data) {
        return ctx.reply(
          `${pe(PE.notification, '❌')} Leaderboard ယူမရပါ။\n(API endpoint မရနိုင်သေးပါ)`,
          { parse_mode: 'HTML' }
        );
      }

      let text =
        `${pe(PE.myid, '🏆')} <b>Leaderboard</b>\n` +
        `Week ${data.week_number || '?'} (${data.year || ''})\n` +
        `════════════════════\n\n`;

      const top = (data.top_players || data.players || []).slice(0, 10);
      if (top.length) {
        for (const p of top) {
          const rank = p.rank || '?';
          const name = String(p.user_name || p.name || 'Unknown').slice(0, 12);
          const score = Number(p.total_jackfruits || p.score || 0).toLocaleString();
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
          text += `${medal} ${name}  🍈 ${score}\n`;
        }
      } else {
        text += `No players found\n`;
      }

      if (data.current_player_rank) {
        const r = data.current_player_rank;
        text += `\n👤 Your Rank: ${r.rank || '?'}  🍈 ${Number(r.total_jackfruits || 0).toLocaleString()}`;
      }

      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('MYTEL Leaderboard error:', error);
      await ctx.reply(`${pe(PE.notification, '❌')} Leaderboard ဖွင့်ရာတွင် အခက်အခဲရှိနေပါတယ်။`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });
});


bot.hears('💰 လက်ကျန်ငွေစစ်ရန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.x, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  const waitMsg = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>လက်ကျန်ငွေ စစ်ဆေးနေပါတယ်...</b>`,
    { parse_mode: 'HTML' }
  );

  try {
    const res = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/lightweight-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.x, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Success
    if (res?.status === 'success') {
      const attr = res.data?.attribute || {};

      const mb = Number(
        attr.mainBalance?.value ?? 0
      );

      const dataPack = Number(
        attr.packsPieData?.data?.remaining ?? 0
      );

      const voicePack = Number(
        attr.packsPieData?.voice?.remaining ?? 0
      );

      const smsPack = Number(
        attr.packsPieData?.sms?.remaining ?? 0
      );

      const message =
        `${pe(PE.balance, '💰')} <b>လက်ကျန်ငွေ အချက်အလက်</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.balance, '💵')} <b>Balance</b>\n` +
        `└ <code>${mb.toLocaleString()} Ks</code>\n\n` +

        `${pe(PE.data, '🌐')} <b>Data</b>\n` +
        `└ <code>${dataPack.toLocaleString()} MB</code>\n\n` +

        `${pe(PE.voice, '📞')} <b>Voice</b>\n` +
        `└ <code>${voicePack.toLocaleString()} Min</code>\n\n` +

        `${pe(PE.sms, '💬')} <b>SMS</b>\n` +
        `└ <code>${smsPack.toLocaleString()} SMS</code>\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>စစ်ဆေးမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // API Error
    return ctx.reply(
      `${pe(PE.x, '❌')} <b>အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ထပ်စမ်းကြည့်ပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error('Balance Check Error:', error);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    return ctx.reply(
      `${pe(PE.x, '❌')} <b>လက်ကျန်ငွေ စစ်ဆေးရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `ခဏနေမှ ပြန်စမ်းကြည့်ပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears('📊 ပွိုင့်စစ်ရန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  const waitMsg = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>ပွိုင့်များကို စစ်ဆေးနေပါတယ်...</b>`,
    {
      parse_mode: 'HTML'
    }
  );

  try {
    const res = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/point-system/dashboard?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Success
    if (res?.status === 'success') {
      const attr = res.data?.attribute || {};

      const totalPoint = Number(
        attr.totalPoint ?? 0
      );

      const starStatusLabel =
        attr.starStatusLabel ?? '—';

      const validityEndDateText =
        attr.validityEndDateText ?? '—';

      const message =
        `${pe(PE.chart, '📊')} <b>ပွိုင့်အချက်အလက်</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.balance, '⭐')} <b>ပွိုင့်အမှတ်</b>\n` +
        `└ <code>${totalPoint.toLocaleString()} Pts</code>\n\n` +

        `${pe(PE.check, '🏅')} <b>အဆင့်</b>\n` +
        `└ <b>${starStatusLabel}</b>\n\n` +

        `${pe(PE.notification, '📅')} <b>Point သက်တမ်း</b>\n` +
        `└ <code>${validityEndDateText}</code>\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>စစ်ဆေးမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // API Error
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ထပ်စမ်းကြည့်ပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error('Point Check Error:', error);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ပွိုင့်စစ်ဆေးရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `ခဏနေမှ ပြန်စမ်းကြည့်ပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears('🎟️ TohToh ကူပွန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  const waitMsg = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>TohToh ကူပွန်များကို စစ်ဆေးနေပါတယ်...</b>`,
    {
      parse_mode: 'HTML'
    }
  );

  try {
    const res = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/tohtohunited/get-coupon-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Success
    if (res?.status === 'success') {
      const count = Number(
        res.data?.attribute?.couponBalance?.totalCoupon ?? 0
      );

      const message =
        `${pe(PE.kiki, '🎟️')} <b>TohToh ကူပွန်အချက်အလက်</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.check, '🎟️')} <b>TohToh ဂိမ်း</b>\n` +
        `└ ကစားခွင့် : <code>${count.toLocaleString()} ကြိမ်</code>\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>စစ်ဆေးမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // API Error
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့် အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error('TohToh Coupon Error:', error);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>TohToh ကူပွန် စစ်ဆေးရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears('🌾 ရွှေလယ်တော ကူပွန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  const waitMsg = await ctx.reply(
    `${pe(PE.loading, '⏳')} <b>ရွှေလယ်တော ကူပွန်များကို စစ်ဆေးနေပါတယ်...</b>`,
    {
      parse_mode: 'HTML'
    }
  );

  try {
    const res = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/goldenfarm/get-coupon-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Success
    if (res?.status === 'success') {
      const count = Number(
        res.data?.attribute?.couponBalance ?? 0
      );

      const message =
        `${pe(PE.kiki, '🌾')} <b>ရွှေလယ်တော ကူပွန်အချက်အလက်</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.check, '🎟️')} <b>ရွှေလယ်တော ဂိမ်း</b>\n` +
        `└ ကစားခွင့် : <code>${count.toLocaleString()} ကြိမ်</code>\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>စစ်ဆေးမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // API Error
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့် အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error('Golden Farm Coupon Error:', error);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ရွှေလယ်တော ကူပွန် စစ်ဆေးရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears('🎮 TohToh ဆော့ရန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  try {
    // Cooldown စစ်ခြင်း
    await handleCooldownCountdown(ctx, ctx.from.id);

    const waitMsg = await ctx.reply(
      `${pe(PE.loading, '⏳')} <b>Toh Toh ဂိမ်း ဆော့နေပါတယ်...</b>`,
      {
        parse_mode: 'HTML'
      }
    );

    // Coupon / Dashboard စစ်ခြင်း
    const dashRes = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/tohtohunited/get-coupon-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0&_t=${Date.now()}`
    );

    // Token Expired
    if (dashRes?._authFailed) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Dashboard Error
    if (!dashRes || dashRes.status !== 'success') {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့် အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
        `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
        {
          parse_mode: 'HTML'
        }
      );
    }

    // Coupon Count
    const count = Number(
      dashRes.data?.attribute?.couponBalance?.totalCoupon ?? 0
    );

    // No Coupon
    if (count <= 0) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>လက်ကျန် ကစားခွင့် မရှိတော့ပါ။</b>\n\n` +
        `${pe(PE.balance, '🎟️')} လက်ကျန်အကြိမ် : <code>0</code>`,
        {
          parse_mode: 'HTML'
        }
      );
    }

    // Max Level ရှာခြင်း
    let maxLevel = 3;

    if (Array.isArray(dashRes.data?.attribute?.levelData)) {
      const levels = dashRes.data.attribute.levelData
        .map((l: any) => Number(l?.level))
        .filter((n: number) => Number.isFinite(n));

      if (levels.length > 0) {
        maxLevel = Math.max(...levels);
      }
    }

    const bodyObj = {
      isCompleted: 1,
      currentPlayLevel: maxLevel,
      chosenPrize: "Instant"
    };

    // Game Draw
    const res = await authApiPost(
      ctx.from.id,
      `/mytmapi/v1/my/tohtohunited/draw?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`,
      bodyObj
    );

    setGameCooldown(ctx.from.id);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Game Success
    if (res?.status === 'success' && res.data?.attribute) {
      const attr = res.data.attribute;

      let remaining = count - 1;

      if (attr.toTohBalance?.totalCoupon !== undefined) {
        remaining = Number(attr.toTohBalance.totalCoupon);
      } else if (attr.couponBalance?.totalCoupon !== undefined) {
        remaining = Number(attr.couponBalance.totalCoupon);
      } else if (
        attr.preCouponBalance?.totalCoupon !== undefined &&
        Number(attr.preCouponBalance.totalCoupon) < count
      ) {
        remaining = Number(attr.preCouponBalance.totalCoupon);
      }

      if (!Number.isFinite(remaining) || remaining < 0) {
        remaining = 0;
      }

      const prizeName = attr.prizeName ?? 'ဆုတစ်ခု';
      
      const balanceText =
        remaining > 0
          ? `${pe(PE.balance, '🎟️')} လက်ကျန်အကြိမ် : <code>${remaining.toLocaleString()} ကြိမ်</code>`
          : `${pe(PE.check, '❌')} <b>လက်ကျန် ကစားခွင့် မရှိတော့ပါ။</b>`;

      const message =
        `${pe(PE.kiki, '🎮')} <b>TohToh Game</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.check, '🎉')} <b>ဂုဏ်ယူပါတယ်!</b>\n\n` +
        `${pe(PE.wow, '🏆')} <b>ဆုရရှိပါပြီ</b>\n` +
        `└ <b>${prizeName}</b>\n\n` +

        `${balanceText}\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>ဂိမ်းကစားမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // Game Error
    let errMsg =
      res?.errors?.message?.message ||
      res?.message ||
      res?.errors?.title ||
      'ကစားခွင့် မကျန်တော့ပါ။';

    if (
      res?.errors?.message?.title &&
      typeof res.errors.message.title === 'string' &&
      !res.errors.message.title.includes('Failed') &&
      !res.errors.message.title.includes('မအောင်မြင်ပါ')
    ) {
      errMsg =
        `${res.errors.message.title} - ${errMsg}`;
    }

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>TohToh Game</b>\n\n` +
      `${pe(PE.notification, '⚠️')} ${errMsg}`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error('TohToh Game Error:', error);

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>TohToh ဂိမ်း ဆော့ရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears('🐔 ရွှေလယ်တော ဆော့ရန်', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false)
      }
    );
  }

  try {
    // Cooldown စစ်ခြင်း
    await handleCooldownCountdown(ctx, ctx.from.id);

    const waitMsg = await ctx.reply(
      `${pe(PE.loading, '⏳')} <b>ရွှေလယ်တော ဂိမ်း ဆော့နေပါတယ်...</b>`,
      {
        parse_mode: 'HTML'
      }
    );

    // Coupon Balance စစ်ခြင်း
    const dashRes = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/goldenfarm/get-coupon-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0&_t=${Date.now()}`
    );

    // Token Expired
    if (dashRes?._authFailed) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // API Error
    if (!dashRes || dashRes.status !== 'success') {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့် အချက်အလက်ယူလို့ မရသေးပါဘူး။</b>\n\n` +
        `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
        {
          parse_mode: 'HTML'
        }
      );
    }

    // Coupon Count
    const count = Number(
      dashRes.data?.attribute?.couponBalance ?? 0
    );

    // No Coupon
    if (count <= 0) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>လက်ကျန် ကစားခွင့် မရှိတော့ပါ။</b>\n\n` +
        `${pe(PE.balance, '🎟️')} လက်ကျန်အကြိမ် : <code>0</code>`,
        {
          parse_mode: 'HTML'
        }
      );
    }

    // Max Score ရှာခြင်း
    let maxScore = 165;

    const levelData =
      dashRes.data?.attribute?.levelData;

    if (Array.isArray(levelData)) {
      const extractedScores = levelData
        .map((l: any) => Number(l?.score ?? 0))
        .filter((n: number) => Number.isFinite(n));

      if (extractedScores.length > 0) {
        const highest = Math.max(...extractedScores);

        if (highest > 0) {
          maxScore = highest;
        }
      }
    }

    /*
     * Score ကို maxScore အောက်ကနေ random ရွေးခြင်း
     * မူရင်း logic အတိုင်းထားထားပါတယ်။
     */
    const minScore = Math.max(0, maxScore - 5);

    const randomScore =
      Math.floor(
        Math.random() *
        (maxScore - minScore + 1)
      ) + minScore;

    const bodyObj = {
      score: randomScore
    };

    // Golden Farm Draw
    const res = await authApiPost(
      ctx.from.id,
      `/mytmapi/v1/my/goldenfarm/draw?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`,
      bodyObj
    );

    setGameCooldown(ctx.from.id);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    // Token Expired
    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
        `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    // Game Success
    if (
      res?.status === 'success' &&
      res.data?.attribute
    ) {
      const attr = res.data.attribute;

      let prize = attr.prizeName;

      // Message ထဲက Prize ရှာခြင်း
      if (!prize && attr.message) {
        const match = String(attr.message).match(
          /ဖြစ်ပြီး\s+(.*?)\s+ကို/
        );

        if (match?.[1]) {
          prize = match[1].trim();
        }
      }

      if (!prize) {
        prize =
          attr.prizeAmountText ||
          'ဆုလက်ဆောင်';
      }

      // Remaining Coupon
      let remaining = count - 1;

      if (
        typeof attr.couponBalance === 'number' &&
        attr.couponBalance < count
      ) {
        remaining = attr.couponBalance;
      }

      if (
        !Number.isFinite(remaining) ||
        remaining < 0
      ) {
        remaining = 0;
      }

      const balanceText =
        remaining > 0
          ? `${pe(PE.balance, '🎟️')} လက်ကျန်အကြိမ် : <code>${remaining.toLocaleString()} ကြိမ်</code>`
          : `${pe(PE.check, '❌')} <b>လက်ကျန် ကစားခွင့် မရှိတော့ပါ။</b>`;

      const message =
        `${pe(PE.kiki, '🐔')} <b>ရွှေလယ်တော Game</b>\n` +
        `════════════════════\n\n` +

        `${pe(PE.check, '🎉')} <b>ဂုဏ်ယူပါတယ်!</b>\n\n` +

        `${pe(PE.wow, '🏆')} <b>ဆုရရှိပါပြီ</b>\n` +
        `└ <b>${prize}</b>\n\n` +

        `${balanceText}\n\n` +

        `════════════════════\n` +
        `${pe(PE.check, '✅')} <b>ဂိမ်းကစားမှု အောင်မြင်ပါသည်</b>`;

      return ctx.reply(message, {
        parse_mode: 'HTML'
      });
    }

    // Game Error
    const errorMsg =
      res?.message ||
      res?.originalResponse?.message ||
      'ကစားခွင့် မကျန်တော့ပါ။';

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ရွှေလယ်တော Game</b>\n\n` +
      `${pe(PE.notification, '⚠️')} ${errorMsg}`,
      {
        parse_mode: 'HTML'
      }
    );

  } catch (error) {
    console.error(
      'Golden Farm Game Error:',
      error
    );

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ရွှေလယ်တော ဂိမ်း ဆော့ရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
      `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML'
      }
    );
  }
});

bot.hears(
  ['🎟️ TohToh Live ဝယ်ယူရန်', '🔴 TohToh Live ဝယ်ယူရန်'],
  async (ctx) => {
    const sess = await getSession(ctx.from.id);

    if (!sess) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false)
        }
      );
    }

    let waitMsg;

    try {
      waitMsg = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>ခဏစောင့်ပေးပါ...</b>`,
        {
          parse_mode: 'HTML'
        }
      );

      const getPackRes = await authApiGet(
        ctx.from.id,
        `/mytmapi/v1/my/tohtohunited/get-coupon-balance?msisdn=${encodeURIComponent(sess.msisdn)}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0`
      );

      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      // Token Expired
      if (getPackRes?._authFailed) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
          `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false)
          }
        );
      }

      // API Error
      if (
        !getPackRes ||
        getPackRes.status !== 'success'
      ) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့် ပက်ကေ့ချ်များကို ရယူလို့ မရသေးပါဘူး။</b>\n\n` +
          `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          {
            parse_mode: 'HTML'
          }
        );
      }

      // Pack List
      const packs =
        getPackRes.data?.attribute?.luckyChanceItems?.packPurchase
          ?.filter(
            (p: any) =>
              p?.type === 'toh_toh_united_pack'
          ) ?? [];

      if (!Array.isArray(packs) || packs.length === 0) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>ဝယ်ယူရန် ပက်ကေ့ချ် ရှာမတွေ့ပါ။</b>`,
          {
            parse_mode: 'HTML'
          }
        );
      }

      // Pack Buttons
      const buttons = packs.map((p: any) => {
        const chances = Number(p?.chances ?? 0);
        const price = Number(p?.price ?? 0);

        const title =
          String(p?.title ?? '').toLowerCase();

        const isDoublePack =
          title.includes('2x') ||
          title.includes('double') ||
          (price > 0 && chances / price >= 0.02);

        let displayPrice = '';

        const desc = String(p?.desc ?? '');

        const priceMatch =
          desc.match(/[\d,]+/);

        if (priceMatch?.[0]) {
          displayPrice =
            `${priceMatch[0]} KS`;
        } else {
          displayPrice =
            `${price.toLocaleString()} KS`;
        }

        const text =
          `${chances.toLocaleString()} Lives` +
          `${isDoublePack ? ' (x2)' : ''}` +
          ` - ${displayPrice}`;

        return [
          Markup.button.callback(
            text,
            `buy_tohtoh_${p.offerId}`
          )
        ];
      });

      const message =
        `${pe(PE.kiki, '🎟️')} <b>TohToh Live</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.notification, '🛒')} <b>ဝယ်ယူလိုသော ပက်ကေ့ချ်ကို ရွေးချယ်ပါ</b>\n\n` +
        `${pe(PE.check, '🎟️')} Live အရေအတွက်နှင့် ဈေးနှုန်းကို အောက်တွင် ရွေးချယ်နိုင်ပါတယ်။`;

      return ctx.reply(
        message,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        }
      );

    } catch (error) {
      console.error(
        'TohToh Live Purchase Error:',
        error
      );

      if (waitMsg) {
        await ctx.telegram
          .deleteMessage(
            ctx.chat.id,
            waitMsg.message_id
          )
          .catch(() => {});
      }

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>TohToh Live ပက်ကေ့ချ်များ ရယူရာမှာ Error ဖြစ်သွားပါတယ်။</b>\n\n` +
        `${pe(PE.loading, '⏳')} ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
        {
          parse_mode: 'HTML'
        }
      );
    }
  }
);

bot.action(/buy_tohtoh_(.+)/, async (ctx) => {
  const offerId = ctx.match[1];
  const sess = await getSession(ctx.from?.id);
  if (!sess) {
    await ctx.answerCbQuery("❌ အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။", { show_alert: true });
    return;
  }
  
  await ctx.answerCbQuery();
  const waitMsg = await ctx.reply("⏳ ခနစောင့်ပေးပါ...");

  const bodyObj = { offerId };
  const buyRes = await authApiPost(ctx.from.id, `/mytmapi/v1/my/tohtohunited/purchase-game-pack-life?msisdn=${sess.msisdn}&userid=${sess.userId}&v=4.16.0`, bodyObj);

  await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

  if (buyRes?._authFailed) {
      await ctx.reply("❌ အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။ ကျေးဇူးပြု၍ '🔄 အကောင့်ထွက်ရန်' ကိုနှိပ်ပြီး အကောင့်ပြန်ဝင်ပေးပါ။", getMainKeyboard(false));
      return;
  }

  if (buyRes && buyRes.status === 'success') {
     // Fetch the updated balance to show
     const getPackRes = await authApiGet(ctx.from.id, `/mytmapi/v1/my/tohtohunited/get-coupon-balance?msisdn=${sess.msisdn}&userid=${sess.userId}&v=4.16.0`);
     let remain = '-';
     if (getPackRes && getPackRes.status === 'success') {
        remain = getPackRes.data?.attribute?.couponBalance?.totalCoupon ?? getPackRes.data?.attribute?.couponBalance ?? getPackRes.data?.attribute?.toTohBalance?.totalCoupon ?? '-';
     }
     await ctx.editMessageText(`✅ ၀ယ်ယူမှုအောင်မြင်ပါတယ်။ ယခုလက်ကျန်အကြိမ် - ${remain}`);
  } else {
     let errMsg = buyRes?.errors?.message?.message || buyRes?.message || buyRes?.errors?.title;
     
     const resString = buyRes ? JSON.stringify(buyRes).toLowerCase() : "";
     const isInsufficient = !buyRes || 
                            resString.includes("insufficient") || 
                            resString.includes("balance") || 
                            resString.includes("credit") || 
                            resString.includes("not enough") || 
                            resString.includes("မလုံလောက်") || 
                            resString.includes("လုံလောက်") || 
                            resString.includes("ငွေ") ||
                            resString.includes("9010") ||
                            resString.includes("9009") ||
                            (errMsg && (
                              errMsg.toLowerCase().includes("insufficient") ||
                              errMsg.toLowerCase().includes("balance") ||
                              errMsg.toLowerCase().includes("မလုံလောက်") ||
                              errMsg.toLowerCase().includes("ငွေ")
                            ));

     if (isInsufficient || !errMsg) {
       errMsg = "လက်ကျန်ငွေ မလုံလောက်ပါ။";
     } else if (buyRes?.errors?.message?.title && typeof buyRes.errors.message.title === 'string' && !buyRes.errors.message.title.includes("Failed") && !buyRes.errors.message.title.includes("မအောင်မြင်ပါ")) {
         errMsg = buyRes.errors.message.title + " - " + errMsg;
     }

     await ctx.editMessageText(`❌ ${errMsg}`);
  }
});

bot.hears(
  ['🌾 ရွှေလယ်တော Live ဝယ်ယူရန်', '🟡 ရွှေလယ်တော Live ဝယ်ယူရန်'],
  async (ctx) => {
    const sess = await getSession(ctx.from.id);

    if (!sess) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      );
    }

    let waitMsg: any;

    try {
      waitMsg = await ctx.reply(
        `${pe(PE.loading, '⏳')} <b>ခဏစောင့်ပေးပါ...</b>`,
        { parse_mode: 'HTML' }
      );

      const res = await authApiGet(
        ctx.from.id,
        `/mytmapi/v1/my/goldenfarm/get-coupon-balance?msisdn=${encodeURIComponent(
          sess.msisdn
        )}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0&_t=${Date.now()}`
      );

      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      if (res?._authFailed) {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ <b>အကောင့်ထွက်ပြီး</b> ပြန်ဝင်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }

      if (!res || res.status !== 'success') {
        return ctx.reply(
          `${pe(PE.check, '❌')} <b>ဆာဗာအခက်အခဲကြောင့်</b>\n` +
            `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
          { parse_mode: 'HTML' }
        );
      }

      const purchaseInfo = res.data?.attribute?.purchaseLife;

      const price = Number(purchaseInfo?.price ?? 99);

      const title =
        String(purchaseInfo?.regular?.title ?? '1 Lives').trim() ||
        '1 Lives';

      const buttons = [
        [
          Markup.button.callback(
            `${pe(PE.balance, '🎟️')} ${title} - ${price.toLocaleString()} KS`,
            'buy_goldenfarm'
          ),
        ],
      ];

      const message =
        `${pe(PE.kiki, '🌾')} <b>ရွှေလယ်တော Live</b>\n` +
        `════════════════════\n\n` +
        `${pe(PE.notification, '🛒')} <b>ဝယ်ယူလိုသော ပက်ကေ့ချ်ကို ရွေးချယ်ပါ</b>\n\n` +
        `${pe(PE.check, '🎟️')} Live အရေအတွက်နှင့် ဈေးနှုန်းကို အောက်တွင် ရွေးချယ်နိုင်ပါတယ်။`;

      return ctx.reply(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      });
    } catch (error) {
      if (waitMsg) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, waitMsg.message_id)
          .catch(() => {});
      }

      console.error('Golden Farm Live menu error:', error);

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>တစ်ခုခုအမှားဖြစ်သွားပါတယ်။</b>\n` +
          `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
        { parse_mode: 'HTML' }
      );
    }
  }
);


bot.action('buy_goldenfarm', async (ctx) => {
  const sess = await getSession(ctx.from?.id);

  if (!sess) {
    await ctx.answerCbQuery(
      `${pe(PE.check, '❌')} အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။`,
      { show_alert: true }
    );
    return;
  }

  await ctx.answerCbQuery().catch(() => {});

  let waitMsg: any;

  try {
    waitMsg = await ctx.reply(
      `${pe(PE.loading, '⏳')} <b>ဝယ်ယူနေပါတယ်... ခဏစောင့်ပေးပါ။</b>`,
      { parse_mode: 'HTML' }
    );

    const res = await authApiGet(
      ctx.from.id,
      `/mytmapi/v1/my/goldenfarm/purchase-life?msisdn=${encodeURIComponent(
        sess.msisdn
      )}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0&_t=${Date.now()}`
    );

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    if (res?._authFailed) {
      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
          `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ <b>အကောင့်ထွက်ပြီး</b> ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      );
    }

    if (res && res.status === 'success') {
      // Updated balance
      const getPackRes = await authApiGet(
        ctx.from.id,
        `/mytmapi/v1/my/goldenfarm/get-coupon-balance?msisdn=${encodeURIComponent(
          sess.msisdn
        )}&userid=${encodeURIComponent(sess.userId)}&v=4.16.0&_t=${Date.now()}`
      );

      let remain: number | string = '-';

      if (getPackRes?.status === 'success') {
        remain = Number(
          getPackRes.data?.attribute?.couponBalance ?? 0
        );
      }

      return ctx.reply(
        `${pe(PE.check, '✅')} <b>ဝယ်ယူမှု အောင်မြင်ပါတယ်။</b>\n\n` +
          `${pe(PE.kiki, '🌾')} <b>ရွှေလယ်တော Live</b>\n` +
          `${pe(PE.balance, '🎟️')} လက်ကျန်အကြိမ် - <b>${remain.toLocaleString?.() ?? remain}</b>`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      );
    }

    let errMsg =
      res?.errors?.message?.message ||
      res?.message ||
      res?.errors?.title ||
      '';

    const resString = res
      ? JSON.stringify(res).toLowerCase()
      : '';

    const errorText = String(errMsg).toLowerCase();

    const isInsufficient =
      !res ||
      resString.includes('insufficient') ||
      resString.includes('balance') ||
      resString.includes('credit') ||
      resString.includes('not enough') ||
      resString.includes('မလုံလောက်') ||
      resString.includes('လုံလောက်') ||
      resString.includes('ငွေ') ||
      resString.includes('9010') ||
      resString.includes('9009') ||
      errorText.includes('insufficient') ||
      errorText.includes('balance') ||
      errorText.includes('မလုံလောက်') ||
      errorText.includes('ငွေ');

    if (isInsufficient || !errMsg) {
      errMsg = 'လက်ကျန်ငွေ မလုံလောက်ပါ။';
    } else if (
      res?.errors?.message?.title &&
      typeof res.errors.message.title === 'string' &&
      !res.errors.message.title.includes('Failed') &&
      !res.errors.message.title.includes('မအောင်မြင်ပါ')
    ) {
      errMsg =
        `${res.errors.message.title} - ${errMsg}`;
    }

    if (
      typeof res === 'string' &&
      res.includes('404')
    ) {
      errMsg = 'လောလောဆယ် ဝယ်ယူ၍မရနိုင်သေးပါ။';
    }

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>${errMsg}</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false),
      }
    );
  } catch (error) {
    if (waitMsg) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});
    }

    console.error('Golden Farm Live purchase error:', error);

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>ဝယ်ယူနေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
        `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false),
      }
    );
  }
});

bot.hears('🎁 Daily Point Claim', async (ctx) => {
  const sess = await getSession(ctx.from.id);

  if (!sess) {
    return ctx.reply(
      `${pe(PE.check, '❌')} <b>အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။</b>`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false),
      }
    );
  }

  let waitMsg: any;

  try {
    waitMsg = await ctx.reply(
      `${pe(PE.loading, '⏳')} <b>နေ့စဉ် Point ရယူနိုင်မလား စစ်ဆေးနေပါတယ်...</b>`,
      { parse_mode: 'HTML' }
    );

    const baseQuery =
      `msisdn=${encodeURIComponent(sess.msisdn)}` +
      `&userid=${encodeURIComponent(sess.userId)}` +
      `&v=4.16.0&_t=${Date.now()}`;

    // Initialize / refresh point information
    const initEndpoints = [
      `/mytmapi/v1/my/dashboard?${baseQuery}`,
      `/mytmapi/v1/my/point-system/dashboard?${baseQuery}`,
      `/mytmapi/v1/my/point-system/campaign-list?${baseQuery}`,
      `/mytmapi/v1/my/point-system/checkin?${baseQuery}`,
      `/mytmapi/v1/my/point-system/check-in?${baseQuery}`,
      `/mytmapi/v2/my/point-system/checkin?${baseQuery}`,
      `/mytmapi/v1/my/point-system/daily-checkin?${baseQuery}`,
      `/mytmapi/v1/my/point-system/checkin-list?${baseQuery}`,
      `/mytmapi/v2/my/point-system/checkin-list?${baseQuery}`,
    ];

    for (const endpoint of initEndpoints) {
      const initRes = await authApiGet(ctx.from.id, endpoint);

      if (initRes?._authFailed) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, waitMsg.message_id)
          .catch(() => {});

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး ပြန်ဝင်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }
    }

    // Try POST initialization
    const postEndpoints = [
      `/mytmapi/v1/my/point-system/check-in?${baseQuery}`,
      `/mytmapi/v2/my/point-system/check-in?${baseQuery}`,
      `/mytmapi/v1/my/point-system/checkin?${baseQuery}`,
      `/mytmapi/v2/my/point-system/checkin?${baseQuery}`,
      `/mytmapi/v1/my/point-system/daily-checkin?${baseQuery}`,
    ];

    for (const endpoint of postEndpoints) {
      const postRes = await authApiPost(
        ctx.from.id,
        endpoint,
        {}
      );

      if (postRes?._authFailed) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, waitMsg.message_id)
          .catch(() => {});

        return ctx.reply(
          `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
            `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး ပြန်ဝင်ပေးပါ။`,
          {
            parse_mode: 'HTML',
            ...getMainKeyboard(false),
          }
        );
      }
    }

    // Get claim list
    let listRes = await authApiGet(
      ctx.from.id,
      `/mytmapi/v2/my/point-system/claim-list?${baseQuery}`
    );

    if (listRes?._authFailed) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});

      return ctx.reply(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
          `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      );
    }

    // v2 မရရင် v1 fallback
    if (
      !listRes ||
      listRes.status !== 'success' ||
      !Array.isArray(listRes.data?.attribute?.items)
    ) {
      listRes = await authApiGet(
        ctx.from.id,
        `/mytmapi/v1/my/point-system/claim-list?${baseQuery}`
      );
    }

    let claimId: string | number | null = null;
    let pointsToClaim: string | null = null;

    if (
      listRes &&
      listRes.status === 'success' &&
      Array.isArray(listRes.data?.attribute?.items)
    ) {
      const items = listRes.data.attribute.items;

      const claimableItem = items.find((item: any) => {
        if (!item) return false;

        // Already claimed / disabled
        if (
          item.status === 'CLAIMED' ||
          item.status === 'COMPLETED' ||
          item.isClaimed === true ||
          item.enable === 0 ||
          item.enable === false
        ) {
          return false;
        }

        const str = JSON.stringify(item).toLowerCase();

        if (
          str.includes('"status":"claimed"') ||
          str.includes('"claimed":true') ||
          str.includes('already claimed') ||
          str.includes('"done":true')
        ) {
          return false;
        }

        // Explicitly claimable
        if (item.enable === 1 || item.enable === true) {
          return true;
        }

        if (
          typeof item.status === 'string' &&
          [
            'CLAIMABLE',
            'AVAILABLE',
            'READY',
            'CLAIM',
            'ACTIVE',
          ].includes(item.status.toUpperCase())
        ) {
          return true;
        }

        if (
          item.status === 1 ||
          item.isClaimable === true
        ) {
          return true;
        }

        if (
          str.includes('claimable') ||
          str.includes('ready to claim')
        ) {
          return true;
        }

        if (
          item.action === 'Claim' ||
          item.buttonText === 'Claim' ||
          item.button_text === 'Claim' ||
          item.buttonText === 'ရယူမည်'
        ) {
          return true;
        }

        // Point information exists and not claimed
        if (
          item.point !== undefined ||
          item.points !== undefined ||
          item.pointAmount !== undefined ||
          item.amount !== undefined ||
          item.reward !== undefined ||
          item.value !== undefined
        ) {
          return true;
        }

        return false;
      });

      if (claimableItem) {
        claimId = claimableItem.id;

        const pts =
          claimableItem.point ??
          claimableItem.points ??
          claimableItem.pointAmount ??
          claimableItem.amount ??
          claimableItem.reward ??
          claimableItem.value;

        if (pts !== undefined && pts !== null) {
          const numMatch = String(pts).match(/\d+/);

          pointsToClaim = numMatch
            ? numMatch[0]
            : String(pts);
        } else if (
          claimableItem.label ||
          claimableItem.title
        ) {
          const labelStr = String(
            claimableItem.label ||
              claimableItem.title
          );

          const numMatch = labelStr.match(/\d+/);

          if (numMatch) {
            pointsToClaim = numMatch[0];
          }
        }
      }
    }

    await ctx.telegram
      .deleteMessage(ctx.chat.id, waitMsg.message_id)
      .catch(() => {});

    if (claimId === null || claimId === undefined) {
      return ctx.reply(
        `${pe(PE.check, '✅')} <b>ဒီနေ့အတွက် Daily Point ရယူပြီးသွားပါပြီ</b>\n\n` +
          `${pe(PE.notification, '📅')} သို့မဟုတ် လောလောဆယ် ရယူရန် Point မရှိသေးပါ။\n` +
          `မနက်ဖြန်မှ ထပ်စမ်းကြည့်ပေးပါဗျ။`,
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(false),
        }
      );
    }

    const pointText = pointsToClaim
      ? `${Number(pointsToClaim).toLocaleString()} Points`
      : 'Daily Point';

    const message =
      `${pe(PE.kiki, '🎁')} <b>Daily Point</b>\n` +
      `════════════════════\n\n` +
      `${pe(PE.chart, '⭐')} ရယူနိုင်သော Point - <b>${pointText}</b>\n\n` +
      `${pe(PE.notification, '🎁')} အောက်က <b>ရယူမည်</b> ကိုနှိပ်ပြီး Point ရယူနိုင်ပါတယ်။`;

    return ctx.reply(message, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `${pe(PE.check, '🎁')} ရယူမည်`,
            `claim_point_${claimId}`
          ),
        ],
      ]),
    });
  } catch (error) {
    if (waitMsg) {
      await ctx.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});
    }

    console.error('Daily Point Claim menu error:', error);

    return ctx.reply(
      `${pe(PE.check, '❌')} <b>Daily Point စစ်ဆေးနေစဉ် အမှားဖြစ်သွားပါတယ်။</b>\n` +
        `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML',
        ...getMainKeyboard(false),
      }
    );
  }
});


bot.action(/claim_point_(.+)/, async (ctx) => {
  const claimId = ctx.match[1];

  const sess = await getSession(ctx.from?.id);

  if (!sess) {
    await ctx.answerCbQuery(
      `${pe(PE.check, '❌')} အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။`,
      { show_alert: true }
    );
    return;
  }

  try {
    await ctx.answerCbQuery().catch(() => {});

    await ctx.editMessageText(
      `${pe(PE.loading, '⏳')} <b>နေ့စဉ် Point ယူနေပါတယ်...</b>`,
      { parse_mode: 'HTML' }
    );

    let parsedId: string | number = claimId;

    if (/^\d+$/.test(claimId)) {
      parsedId = Number(claimId);
    }

    const bodyObj = {
      id: parsedId,
    };

    const baseQuery =
      `msisdn=${encodeURIComponent(sess.msisdn)}` +
      `&userid=${encodeURIComponent(sess.userId)}` +
      `&v=4.16.0&_t=${Date.now()}`;

    // v1 first
    let claimRes = await authApiPost(
      ctx.from.id,
      `/mytmapi/v1/my/point-system/claim?${baseQuery}`,
      bodyObj
    );

    if (claimRes?._authFailed) {
      return ctx.editMessageText(
        `${pe(PE.check, '❌')} <b>အကောင့် Token သက်တမ်းကုန်သွားပါပြီ။</b>\n\n` +
          `${pe(PE.notification, '🔄')} ကျေးဇူးပြု၍ အကောင့်ထွက်ပြီး ပြန်ဝင်ပေးပါ။`,
        {
          parse_mode: 'HTML',
        }
      );
    }

    // v2 fallback
    if (
      !claimRes ||
      claimRes.status !== 'success'
    ) {
      const v2Res = await authApiPost(
        ctx.from.id,
        `/mytmapi/v2/my/point-system/claim?${baseQuery}`,
        bodyObj
      );

      if (
        v2Res &&
        (
          v2Res.status === 'success' ||
          !claimRes
        )
      ) {
        claimRes = v2Res;
      }
    }

    if (
      claimRes &&
      claimRes.status === 'success'
    ) {
      const msg =
        claimRes.data?.attribute?.message ||
        claimRes.message ||
        'အောင်မြင်ပါတယ်ဗျ။';

      return ctx.editMessageText(
        `${pe(PE.check, '🎉')} <b>နေ့စဉ် Point ရယူခြင်း အောင်မြင်ပါတယ်ဗျ။</b>\n\n` +
          `${pe(PE.chart, '⭐')} ${msg}`,
        {
          parse_mode: 'HTML',
        }
      );
    }

    let errMsg =
      claimRes?.errors?.message?.message ||
      claimRes?.message ||
      claimRes?.errors?.title ||
      '';

    if (!errMsg) {
      errMsg =
        'အခုချိန် Point ရယူလို့ မရသေးပါဘူး။';
    }

    const errorText = String(errMsg).toLowerCase();

    if (
      errorText.includes('already claimed') ||
      errorText.includes('already') ||
      errorText.includes('ယူပြီး') ||
      errorText.includes('claimed')
    ) {
      errMsg =
        'ဒီနေ့အတွက် နေ့စဉ် Point ယူပြီးသွားပါပြီ။';
    }

    if (
      claimRes?.errors?.message?.title &&
      typeof claimRes.errors.message.title === 'string' &&
      !claimRes.errors.message.title.includes('Failed') &&
      !claimRes.errors.message.title.includes('မအောင်မြင်ပါ')
    ) {
      errMsg =
        `${claimRes.errors.message.title} - ${errMsg}`;
    }

    return ctx.editMessageText(
      `${pe(PE.check, '❌')} <b>${errMsg}</b>`,
      {
        parse_mode: 'HTML',
      }
    );
  } catch (error) {
    console.error('Daily Point Claim error:', error);

    return ctx.editMessageText(
      `${pe(PE.check, '❌')} <b>Point ရယူနေစဉ် အမှားတစ်ခု ဖြစ်သွားပါတယ်။</b>\n` +
        `ခဏနေမှ ပြန်ကြိုးစားပေးပါဗျ။`,
      {
        parse_mode: 'HTML',
      }
    ).catch(() => {});
  }
});






// ==========================================
// City Run Service (inlined – one file)
// ==========================================

interface CityRunSession {
    userId: string;
    userType: string;
    authToken: string;
    cookies: string[];
}

interface CityRunProfile {
    userId: string;
    userType: string;
    diamonds: number;
    runs: number;
    milestoneCount: number;
    milestones: any[];
    redemptionOptions: any[];
    dailyLoginReward: any[];
    showUnsubscribeBtn: string;
    lastUpdated: number;
}

const cityrunHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
});

class CityRunHttpClient {
    constructor(private session: CityRunSession) {}

    private getHeaders() {
        const headers: any = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9,my;q=0.8',
            'Origin': 'https://cityrun.pro',
            'Referer': `https://cityrun.pro/final_games/toh-toh-v78/?user_id=${this.session.userId}&user_type=${this.session.userType || '1'}`,
            'X-Requested-With': 'mm.com.atom.store',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        };
        if (this.session.authToken) {
            headers['AUTH-TOKEN'] = this.session.authToken;
            headers['auth-token'] = this.session.authToken;
        }
        if (this.session.cookies && this.session.cookies.length > 0) {
            headers['Cookie'] = this.session.cookies.join('; ');
        }
        return headers;
    }

    async post(endpoint: string, data: any) {
        const url = `https://cityrun.pro${endpoint}`;
        const startTime = Date.now();
        console.log(`[CityRun] POST ${endpoint} for User: ${this.session.userId.substring(0, 4)}****`);

        try {
            const res = await axios.post(url, data, {
                headers: this.getHeaders(),
                httpsAgent: cityrunHttpsAgent,
                timeout: 15000,
                validateStatus: () => true
            });
            const duration = Date.now() - startTime;
            console.log(`[CityRun] POST ${endpoint} -> HTTP ${res.status} (Duration: ${duration}ms)`);
            return res;
        } catch (e: any) {
            const duration = Date.now() - startTime;
            console.error(`[CityRun] POST ${endpoint} -> Error: ${e.message} (Duration: ${duration}ms)`);
            throw e;
        }
    }
}

class CityRunService {
    /**
     * Try auto-init via msisdn redirect.
     * Note: City Run usually requires ATOM data network, so this often fails with NEED_URL.
     * On success returns session; on network/billing block throws Error with message "NEED_URL".
     */
    static async initializeSession(msisdn: string): Promise<CityRunSession> {
        console.log(`[CityRun] Auto-init attempt for MSISDN: ${msisdn.substring(0, 4)}****`);
        let cleanMsisdn = msisdn.replace(/\D/g, '');
        if (cleanMsisdn.startsWith('0')) cleanMsisdn = '95' + cleanMsisdn.substring(1);
        if (!cleanMsisdn.startsWith('95')) cleanMsisdn = '95' + cleanMsisdn;

        const entryUrls = [
          `https://cityrun.pro/ws/redirect/?AdNetwork=atom_app&ClickID=&Publisher=&msisdn=${cleanMsisdn}`,
          `https://cityrun.pro/ws/redirect/?msisdn=${cleanMsisdn}`,
          `https://cityrun.pro/final_games/toh-toh-v78/?msisdn=${cleanMsisdn}`,
          `https://cityrun.pro/?msisdn=${cleanMsisdn}`,
        ];

        const commonHeaders: any = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,my;q=0.8',
            'X-Requested-With': 'mm.com.atom.store',
            'Origin': 'https://cityrun.pro',
            'Referer': 'https://cityrun.pro/',
        };

        for (const startUrl of entryUrls) {
          let currentUrl = startUrl;
          let cookies: string[] = [];
          let authToken = '';
          let userId = '';
          let userType = '';

          for (let i = 0; i < 10; i++) {
            try {
                const headers = { ...commonHeaders };
                if (cookies.length > 0) headers['Cookie'] = cookies.join('; ');

                const res = await axios.get(currentUrl, {
                    headers,
                    maxRedirects: 0,
                    validateStatus: () => true,
                    httpsAgent: cityrunHttpsAgent,
                    timeout: 12000
                });

                if (res.headers['set-cookie']) {
                    res.headers['set-cookie'].forEach((c: string) => {
                        const cookiePart = c.split(';')[0].trim();
                        const name = cookiePart.split('=')[0];
                        const idx = cookies.findIndex(ex => ex.startsWith(name + '='));
                        if (idx >= 0) cookies[idx] = cookiePart;
                        else if (!cookies.includes(cookiePart)) cookies.push(cookiePart);
                    });
                }

                if (res.status >= 300 && res.status < 400 && res.headers.location) {
                    let nextLoc = res.headers.location;
                    if (nextLoc.startsWith('//')) nextLoc = 'https:' + nextLoc;
                    currentUrl = new URL(nextLoc, currentUrl).href;
                    // billing/vpn pages → try next entry URL
                    if (currentUrl.includes('BillingError') || currentUrl.toLowerCase().includes('vpn')) {
                        break;
                    }
                    continue;
                }

                if (res.data && typeof res.data === 'string') {
                    if (res.data.includes('VPN') || res.data.includes('BillingError') || res.data.includes('ATOM ဒေတာ') || res.data.includes('ပိတ်ပြီး')) {
                        break;
                    }
                    const tokenMatch = res.data.match(/['"]?AUTH[-_]?TOKEN['"]?\s*[:=]\s*['"]([^'"]+)['"]/i) ||
                        res.data.match(/auth[_-]?token\s*[:=]\s*['"]([^'"]+)['"]/i) ||
                        res.data.match(/"token"\s*:\s*"([^"]+)"/i);
                    if (tokenMatch) authToken = tokenMatch[1];
                    const uidMatch = res.data.match(/user_id[=:]["']?(\d+)/i);
                    if (uidMatch) userId = uidMatch[1];
                    const utMatch = res.data.match(/user_type[=:]["']?([^"'&\s]+)/i);
                    if (utMatch) userType = utMatch[1];
                }
                break;
            } catch (e: any) {
                console.error(`[CityRun] Redirect step error: ${e.message}`);
                break;
            }
          }

          try {
            const finalUrl = new URL(currentUrl);
            if (!finalUrl.href.includes('BillingError') && !finalUrl.href.toLowerCase().includes('vpn')) {
              if (!userId) userId = finalUrl.searchParams.get('user_id') || finalUrl.searchParams.get('userid') || '';
              if (!userType) userType = finalUrl.searchParams.get('user_type') || finalUrl.searchParams.get('usertype') || '1';
              if (!authToken) {
                authToken = finalUrl.searchParams.get('token') || finalUrl.searchParams.get('auth_token') || finalUrl.searchParams.get('AUTH-TOKEN') || '';
              }
            }
          } catch {}

          if (userId) {
            console.log(`[CityRun] Auto session OK. UserID: ${userId.substring(0, 4)}****, Token: ${!!authToken}`);
            return { userId, userType: userType || '1', authToken, cookies };
          }
          console.log(`[CityRun] Entry failed, trying next...`);
        }

        throw new Error('NEED_URL');
    }

    /**
     * Parse user_id, user_type, token from a City Run game URL that the user copied
     * after opening the game on ATOM data.
     */
    static parseSessionFromUrl(urlOrText: string): CityRunSession {
        let text = (urlOrText || '').trim();

        // Allow user to paste full message; extract the first cityrun URL
        const urlMatch = text.match(/https?:\/\/[^\s]*cityrun\.pro[^\s]*/i);
        if (urlMatch) {
            text = urlMatch[0];
        }

        let userId = '';
        let userType = '1';
        let authToken = '';

        try {
            // Normalize & decode
            if (!text.startsWith('http')) {
                // Maybe just query string or key=value pairs
                text = 'https://cityrun.pro/?' + text.replace(/^[?&]/, '');
            }
            const u = new URL(text);

            userId = u.searchParams.get('user_id') || u.searchParams.get('userid') || u.searchParams.get('userId') || '';
            userType = u.searchParams.get('user_type') || u.searchParams.get('usertype') || u.searchParams.get('userType') || '1';
            authToken = u.searchParams.get('token') || u.searchParams.get('auth_token') || u.searchParams.get('AUTH-TOKEN') || u.searchParams.get('authToken') || '';
        } catch {
            // Fallback regex
            const uid = text.match(/user[_-]?id[=:]["']?(\d+)/i);
            const ut = text.match(/user[_-]?type[=:]["']?([^&"' \s]+)/i);
            const tk = text.match(/(?:auth[_-]?)?token[=:]["']?([a-zA-Z0-9._\-]{10,})/i);
            if (uid) userId = uid[1];
            if (ut) userType = ut[1];
            if (tk) authToken = tk[1];
        }

        if (!userId) {
            throw new Error(
                "URL ထဲမှာ user_id မတွေ့ပါ။\n\n" +
                "ဂိမ်း page ရဲ့ full URL ကို ကူးယူပို့ပေးပါ။\n" +
                "ဥပမာ:\nhttps://cityrun.pro/final_games/toh-toh-v78/?user_id=123456&user_type=1&token=abc..."
            );
        }

        console.log(`[CityRun] Parsed session from URL. UserID: ${userId.substring(0, 4)}****, Token: ${!!authToken}`);
        return {
            userId,
            userType: userType || '1',
            authToken: authToken || '',
            cookies: []
        };
    }

    static async getUserData(session: CityRunSession): Promise<CityRunProfile> {
        const client = new CityRunHttpClient(session);
        const res = await client.post('/getUserData', { user_id: session.userId });

        if (res.status === 401 || res.status === 403) {
            throw new Error(`Unauthorized / Token expired (HTTP ${res.status})`);
        }
        if (res.status !== 200 || !res.data || res.data.status !== 'success') {
            const desc = res.data?.description || res.data?.message || res.status;
            const lower = String(desc).toLowerCase();
            if (lower.includes('token') || lower.includes('auth') || lower.includes('expired') || lower.includes('invalid') || lower.includes('unauthorized') || lower.includes('session')) {
                throw new Error(`Token/Session invalid: ${desc}`);
            }
            throw new Error(`Failed to get user data: ${desc}`);
        }

        const data = res.data.data || res.data;

        let completedMilestones = 0;
        const milestones = data.milestones || data.milestone || [];
        if (Array.isArray(milestones)) {
            completedMilestones = milestones.filter((m: any) =>
                m.milestone_claimed === "1" || m.milestone_claimed === 1 || m.claimed === true || m.claimed === "1"
            ).length;
        }

        return {
            userId: data.user_id || session.userId,
            userType: data.user_type || session.userType || '1',
            diamonds: parseInt(data.user_coins || data.diamonds || data.coins || '0') || 0,
            runs: parseInt(data.user_runs || data.runs || '0') || 0,
            milestoneCount: completedMilestones,
            milestones: milestones,
            redemptionOptions: data.coins_redemption || data.redemption_options || data.redemptionOptions || [],
            dailyLoginReward: data.daily_login_reward || data.dailyLoginReward || [],
            showUnsubscribeBtn: data.show_unsubscribe_btn || data.showUnsubscribeBtn || '0',
            lastUpdated: Date.now()
        };
    }

    static async claimMysteryBox(session: CityRunSession, score: number): Promise<any> {
        const client = new CityRunHttpClient(session);
        const res = await client.post('/claimMysteryBox', {
            user_id: session.userId,
            score: score
        });

        if (res.status === 401 || res.status === 403) {
            throw new Error(`Unauthorized / Token expired (HTTP ${res.status})`);
        }
        if (res.status !== 200 || !res.data || res.data.status !== 'success') {
            const desc = res.data?.description || res.data?.message || res.status;
            throw new Error(`Failed to claim milestone: ${desc}`);
        }

        return res.data;
    }

    static async processCoinsRedemption(session: CityRunSession, optionId: string): Promise<any> {
        const client = new CityRunHttpClient(session);
        const res = await client.post('/processCoinsRedemption', {
            user_id: session.userId,
            option_id: optionId
        });

        if (res.status === 401 || res.status === 403) {
            throw new Error(`Unauthorized / Token expired (HTTP ${res.status})`);
        }
        if (res.status !== 200 || !res.data || res.data.status !== 'success') {
            const desc = res.data?.description || res.data?.message || res.status;
            throw new Error(`Failed to redeem diamonds: ${desc}`);
        }

        return res.data;
    }
}


// --- CITY RUN INTEGRATION ---
// City Run: auto-init from VPS often blocked by carrier check.
// After one successful URL paste (or auto-init), API actions work without ATOM data.

const CITYRUN_HELP =
`🏃 <b>City Run Session လိုအပ်ပါတယ်</b>

Server ကနေ auto login မရလို့ (carrier check) URL တောင်းနေပါတယ်။

<b>နည်း ၁ — URL တစ်ကြိမ်ပို့ (အကြံပြု):</b>
1️⃣ ဖုန်းမှာ ဂိမ်းဖွင့်လို့ရတဲ့ network နဲ့ <a href="https://cityrun.pro">cityrun.pro</a> ဖွင့်
2️⃣ ဂိမ်း page load ပြီး address bar က <b>full URL</b> ကူး
3️⃣ ဒီ chat ထဲ paste လုပ်

<b>နည်း ၂:</b> အောက်က "Session URL ပို့မယ်" နှိပ်ပြီး URL ပို့

✅ တစ်ကြိမ်သိမ်းပြီးရင် <b>Diamond / Redeem / Claim</b> တွေကို ATOM data မလိုဘဲ bot ကနေ လုပ်နိုင်ပါမယ်။
(ဂိမ်းကို ဖုန်း screen ပေါ် ကစားချင်မှသာ browser ဖွင့်ရန်)`;

async function getValidCityRunData(tgUserId: number, msisdn?: string): Promise<{session: CityRunSession, profile: CityRunProfile}> {
    const db = await getDb();
    if (!db.cityrun) db.cityrun = {};
    let session = db.cityrun[tgUserId.toString()];

    // 1) Try existing stored session first (true auto after first successful link)
    if (session && session.userId) {
        try {
            const profile = await CityRunService.getUserData(session);
            return { session, profile };
        } catch (e: any) {
            const msg = (e.message || '').toLowerCase();
            const isAuthIssue = msg.includes('expired') || msg.includes('unauthorized') || msg.includes('invalid') ||
                msg.includes('token') || msg.includes('session') || msg.includes('auth') ||
                e.status === 401 || e.status === 403;
            if (isAuthIssue) {
                delete db.cityrun[tgUserId.toString()];
                await saveDb(db);
                session = null as any;
            } else {
                throw e;
            }
        }
    }

    // 2) Try auto-init with msisdn (works only if City Run accepts the request)
    if (msisdn) {
        try {
            session = await CityRunService.initializeSession(msisdn);
            db.cityrun[tgUserId.toString()] = session;
            await saveDb(db);
            const profile = await CityRunService.getUserData(session);
            return { session, profile };
        } catch (e: any) {
            if (e.message !== 'NEED_URL') {
                console.log(`[CityRun] Auto-init failed: ${e.message}`);
            }
            // fall through → ask for URL
        }
    }

    // 3) Need user to paste game URL once
    throw new Error("NO_SESSION");
}

async function saveCityRunSession(tgUserId: number, session: CityRunSession) {
    const db = await getDb();
    if (!db.cityrun) db.cityrun = {};
    db.cityrun[tgUserId.toString()] = session;
    await saveDb(db);
}

function generateCityRunDashboard(profile: CityRunProfile, session: CityRunSession) {
    const maskedId = profile.userId.length > 4 
        ? profile.userId.substring(0, 4) + '****' + profile.userId.substring(profile.userId.length - 2)
        : profile.userId;

    let msg = `🏃 <b>City Run Profile</b>\n\n`;
    msg += `👤 <b>ID:</b> <code>${maskedId}</code>\n`;
    msg += `👑 <b>Status:</b> ${profile.userType}\n`;
    msg += `💎 <b>Diamond:</b> ${profile.diamonds.toLocaleString()}\n`;
    msg += `🏃 <b>Runs:</b> ${profile.runs.toLocaleString()}\n`;
    msg += `🎯 <b>Milestone:</b> ${profile.milestoneCount}/4\n\n`;

    if (profile.milestoneCount === 4) {
        msg += `✅ Milestones အားလုံး Claim ပြီးပါပြီ\n`;
    } else {
        msg += `⏳ Milestones ${4 - profile.milestoneCount} ခု ကျန်ပါသေးတယ်\n`;
    }

    const inlineKeyboard: any[][] = [];

    if (profile.redemptionOptions && profile.redemptionOptions.length > 0) {
        msg += `\n💎 <b>DIAMOND EXCHANGE</b>\n`;
        const sortedOptions = [...profile.redemptionOptions].sort((a, b) => parseInt(a.coins_threshold_value || a.coins_required || 0) - parseInt(b.coins_threshold_value || b.coins_required || 0));
        
        for (const opt of sortedOptions) {
            const cost = parseInt(opt.coins_threshold_value || opt.coins_required);
            const reward = parseInt(opt.coins_runs || opt.runs_reward) || opt.coins_runs || opt.runs_reward;
            
            inlineKeyboard.push([
                { text: `💎 ${cost} ➡️ 🏃 ${reward} Runs`, callback_data: `cityrun:redeem:${opt.id || opt.option_id || opt.coins_id}` }
            ]);
        }
    }

    if (profile.milestones && profile.milestones.length > 0) {
        const unclaimed = profile.milestones.filter((m: any) => m.milestone_claimed === "0");
        if (unclaimed.length > 0) {
            inlineKeyboard.push([{ text: `🎁 Claim Mystery Box`, callback_data: `cityrun:claim:auto` }]);
        }
    }

    inlineKeyboard.push([
        { text: `🏃 ကစားမယ် (Play)`, url: `https://cityrun.pro/final_games/toh-toh-v78/?user_id=${profile.userId}&user_type=${profile.userType}&token=${session.authToken || ''}` }
    ]);
    inlineKeyboard.push([
        { text: `🔄 Refresh`, callback_data: `cityrun:refresh` },
        { text: `🔗 Session အသစ်`, callback_data: `cityrun:newsession` }
    ]);

    return { msg, inlineKeyboard };
}

async function replyCityRunHelp(ctx: any) {
    await ctx.reply(CITYRUN_HELP, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏃 ဂိမ်းဖွင့်ရန်', url: 'https://cityrun.pro' }],
                [{ text: '🔗 Session URL ပို့မယ်', callback_data: 'cityrun:awaiturl' }]
            ]
        }
    });
}

bot.hears(['🏃 City Run ကူပွန်', '🏃 City Run ဆော့ရန်', '💎 City Run Diamond Exchange'], async (ctx) => {
    const sess = await getSession(ctx.from.id);
    if (!sess) return ctx.reply("❌ အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။", getMainKeyboard(false));

    const waitMsg = await ctx.reply("⏳ City Run Auto ယူနေပါတယ်...");
    try {
        const { profile, session } = await getValidCityRunData(ctx.from.id, sess.msisdn);
        const { msg, inlineKeyboard } = generateCityRunDashboard(profile, session);
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
    } catch (e: any) {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        if (e.message === 'NO_SESSION') {
            await replyCityRunHelp(ctx);
        } else {
            await ctx.reply(`❌ Error: ${e.message}`);
        }
    }
});

bot.action('cityrun:refresh', async (ctx) => {
    await ctx.answerCbQuery("🔄 Refreshing...").catch(() => {});
    const sess = await getSession(ctx.from?.id);
    if (!sess) return ctx.editMessageText("❌ အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။");

    try {
        const { profile, session } = await getValidCityRunData(ctx.from.id, sess.msisdn);
        const { msg, inlineKeyboard } = generateCityRunDashboard(profile, session);
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(() => {});
    } catch (e: any) {
        if (e.message === 'NO_SESSION') {
            await ctx.editMessageText(CITYRUN_HELP, { parse_mode: 'HTML' }).catch(() => {});
            await replyCityRunHelp(ctx);
        } else {
            await ctx.editMessageText(`❌ Error: ${e.message}`).catch(() => {});
        }
    }
});

bot.action(['cityrun:newsession', 'cityrun:awaiturl'], async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply(
        "🔗 City Run ဂိမ်း URL ကို ဒီ chat ထဲ ပို့ပေးပါ။\n\n" +
        "ဂိမ်း page URL (user_id + token ပါသော) ကို ကူးယူပို့ပါ။\n" +
        "ဥပမာ:\n<code>https://cityrun.pro/final_games/toh-toh-v78/?user_id=...&token=...</code>",
        { parse_mode: 'HTML' }
    );
});

// Listen for City Run URLs that users paste
bot.hears(/cityrun\.pro/i, async (ctx) => {
    const text = ctx.message?.text || '';
    if (!text) return;

    const sess = await getSession(ctx.from.id);
    if (!sess) return ctx.reply("❌ အရင်ဆုံး အကောင့်ဝင်ပေးပါဦးဗျ။", getMainKeyboard(false));

    const waitMsg = await ctx.reply("⏳ City Run session သိမ်းနေပါတယ်...");
    try {
        const session = CityRunService.parseSessionFromUrl(text);
        // Verify the session actually works
        const profile = await CityRunService.getUserData(session);
        await saveCityRunSession(ctx.from.id, session);

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        const { msg, inlineKeyboard } = generateCityRunDashboard(profile, session);
        await ctx.reply("✅ Session သိမ်းပြီးပါပြီ!\n\n" + msg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } catch (e: any) {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        await ctx.reply(`❌ Session မရပါ: ${e.message}`);
    }
});

const locks = new Set<string>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (locks.has(key)) {
        throw new Error("လုပ်ဆောင်ချက်တစ်ခု လုပ်ဆောင်နေဆဲဖြစ်ပါသည်။ ခဏစောင့်ပေးပါ။ (Action in progress)");
    }
    locks.add(key);
    try {
        return await fn();
    } finally {
        locks.delete(key);
    }
}

bot.action(/cityrun:redeem:(.+)/, async (ctx) => {
    const optionId = ctx.match[1];
    const tgUserId = ctx.from.id;
    
    await ctx.answerCbQuery("⏳ Processing...").catch(()=>{});
    
    const sess = await getSession(tgUserId);
    if (!sess) return ctx.editMessageText("❌ အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။");

    try {
        await withLock(`cityrun_lock:${tgUserId}`, async () => {
            let { session, profile } = await getValidCityRunData(tgUserId, sess.msisdn);
            
            const option = profile.redemptionOptions.find((o: any) => o.id === optionId || o.option_id === optionId || o.coins_id === optionId);
            if (!option) {
                await ctx.reply("❌ Invalid redemption option.");
                return;
            }
            
            const cost = parseInt(option.coins_threshold_value || option.coins_required);
            if (profile.diamonds < cost) {
                await ctx.reply(`❌ <b>Insufficient Diamond</b>\n\nRequired: ${cost} 💎\nAvailable: ${profile.diamonds} 💎`, { parse_mode: 'HTML' });
                return;
            }
            
            await CityRunService.processCoinsRedemption(session, optionId);
            profile = await CityRunService.getUserData(session);
            
            const reward = parseInt(option.coins_runs || option.runs_reward) || option.coins_runs || option.runs_reward;
            
            let successMsg = `✅ <b>Diamond Exchange Success</b>\n\n`;
            successMsg += `💎 <b>Used:</b> ${cost}\n`;
            successMsg += `🏃 <b>Received:</b> ${reward} Runs\n\n`;
            successMsg += `💎 <b>Remaining:</b> ${profile.diamonds}\n`;
            successMsg += `🏃 <b>Total Runs:</b> ${profile.runs}\n\n`;
            successMsg += `🔄 Balance verified from server.`;
            
            await ctx.reply(successMsg, { parse_mode: 'HTML' });
            
            const { msg, inlineKeyboard } = generateCityRunDashboard(profile, session);
            await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(()=>{});
        });
    } catch (e: any) {
        if (e.message === 'NO_SESSION') {
            await replyCityRunHelp(ctx);
        } else {
            await ctx.reply(`❌ Error: ${e.message}`);
        }
    }
});

bot.action('cityrun:claim:auto', async (ctx) => {
    const tgUserId = ctx.from.id;
    await ctx.answerCbQuery("⏳ Processing...").catch(()=>{});
    
    const sess = await getSession(tgUserId);
    if (!sess) return ctx.editMessageText("❌ အကောင့်ဝင်ရန်လိုအပ်ပါတယ်။");

    try {
        await withLock(`cityrun_lock:${tgUserId}`, async () => {
            let { session, profile } = await getValidCityRunData(tgUserId, sess.msisdn);
            
            if (!profile.milestones || profile.milestones.length === 0) {
                await ctx.reply("❌ No milestones available.");
                return;
            }
            
            // Prefer dynamic thresholds from profile, fallback to known values
            let thresholds: number[] = [];
            if (Array.isArray(profile.milestones) && profile.milestones.length > 0) {
                thresholds = profile.milestones
                    .map((m: any) => parseInt(m.threshold || m.milestone_threshold_value || m.milestone_score || m.score || 0))
                    .filter((t: number) => t > 0)
                    .sort((a: number, b: number) => b - a); // highest first
            }
            if (thresholds.length === 0) {
                thresholds = [6500, 4000, 2500, 1500];
            }
            
            let claimedSomething = false;
            let lastError = null;
            
            for (const t of thresholds) {
                const milestone = profile.milestones.find((m: any) => {
                    const mt = parseInt(m.threshold || m.milestone_threshold_value || m.milestone_score || m.score || 0);
                    return mt === t;
                });
                const isUnclaimed = !milestone || milestone.milestone_claimed === "0" || milestone.milestone_claimed === 0 || milestone.claimed === false || milestone.claimed === "0";
                if (isUnclaimed) {
                    try {
                        const res = await CityRunService.claimMysteryBox(session, t);
                        claimedSomething = true;
                        
                        let rewardText = "";
                        if (res.milestone_reward_details && res.milestone_reward_details.length > 0) {
                            const details = res.milestone_reward_details[0];
                            rewardText = `💎 ${details.milestone_coins || details.coins || '?'} | 🏃 ${details.milestone_runs || details.runs || '?'}`;
                        } else if (res.data) {
                            rewardText = JSON.stringify(res.data).substring(0, 80);
                        }
                        await ctx.reply(`✅ <b>Milestone Claimed (${t})</b>\n\nReward: ${rewardText}`, { parse_mode: 'HTML' });
                        break; 
                    } catch (e: any) {
                        lastError = e;
                    }
                }
            }
            
            if (!claimedSomething) {
                if (lastError) {
                    await ctx.reply(`❌ Cannot claim any milestones right now. Game says: ${lastError.message}`);
                } else {
                    await ctx.reply("✅ All eligible milestones have already been claimed.");
                }
            } else {
                profile = await CityRunService.getUserData(session);
                const { msg, inlineKeyboard } = generateCityRunDashboard(profile, session);
                await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } }).catch(()=>{});
            }
        });
    } catch (e: any) {
        if (e.message === 'NO_SESSION') {
            await replyCityRunHelp(ctx);
        } else {
            await ctx.reply(`❌ Error: ${e.message}`);
        }
    }
});

// ==========================================
// 🛠️ ADMIN PANEL (BULLETPROOF ROUTER EDITION)

export function startBot() {
  bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log("Telegram Bot started successfully!");
  }).catch(e => {
    console.error("Bot launch failed (Possible conflict with old chat instance):", e.message);
    const is409 = e.response && e.response.error_code === 409;
    const isTimeout = e.message && (
      e.message.includes("timed out") ||
      e.message.includes("Timeout") ||
      e.message.includes("ETIMEDOUT")
    );
    const isConflict = e.message && (
      e.message.includes("409") ||
      e.message.includes("Conflict") ||
      e.message.includes("terminated by other getUpdates")
    );
    if (is409 || isTimeout || isConflict) {
      console.log("Retrying bot launch in 5 seconds...");
      setTimeout(startBot, 5000);
    }
  });
}

const app = express();
app.use(express.json());
app.use(cors());

app.get('/api/stats', async (req, res) => {
  const { password } = req.query;
  if (password !== (process.env.ADMIN_PASSWORD || 'admin123')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = await getDb();
  const totalUsers = Object.keys(db.users || {}).length;
  const activeSessions = Object.keys(db.sessions || {}).length;
  res.json({
    totalUsers,
    activeSessions,
    commandUsage: db.stats?.commandUsage || {}
  });
});

app.get('/api/users', async (req, res) => {
  const { password } = req.query;
  if (password !== (process.env.ADMIN_PASSWORD || 'admin123')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = await getDb();
  const usersArray = Object.values(db.users || {});
  res.json({ users: usersArray });
});

app.post('/api/ban', async (req, res) => {
  const { password, userId, action } = req.body;
  if (password !== (process.env.ADMIN_PASSWORD || 'admin123')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const adminId = process.env.ADMIN_USER_ID || '8797803204';
  if (adminId && userId.toString() === adminId.toString() && action === 'ban') {
    return res.status(400).json({ error: 'Cannot ban admin user' });
  }
  const db = await getDb();
  if (!db.users) db.users = {};
  if (db.users[userId]) {
    db.users[userId].banned = action === 'ban';
    await saveDb(db);
    res.json({ success: true, banned: db.users[userId].banned });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/broadcast', async (req, res) => {
  const { password, message } = req.body;
  if (password !== (process.env.ADMIN_PASSWORD || 'admin123')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!message || message.trim() === '') {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  const db = await getDb();
  const users = Object.keys(db.users || {});
  let successCount = 0;
  let failCount = 0;
  
  for (const userId of users) {
    if (db.users[userId] && db.users[userId].banned) continue;
    try {
      await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML' });
      successCount++;
    } catch (e) {
      failCount++;
    }
  }
  
  res.json({ success: true, successCount, failCount });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Admin API server listening on port ${PORT}`);
});

// Fallback only — real handlers (bot.action) are registered earlier and take priority.
// Do NOT show alert here; it causes "query is too old" / double-answer noise.
bot.on('callback_query', async (ctx, next) => {
  const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '(no data)';
  console.log("Unhandled callback query:", data);
  try {
    await ctx.answerCbQuery().catch(() => {});
  } catch (e) {}
  return next();
});

// Automatically start the bot when executed directly
startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
