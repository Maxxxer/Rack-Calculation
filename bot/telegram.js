/**
 * Telegram-бот подтверждения регистраций.
 * При саморегистрации нового клиента бот отправляет админу карточку
 * с кнопками «Одобрить» / «Отклонить». Fallback — веб-админка.
 *
 * Настройка: .env → TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID (см. README).
 */
'use strict';

const { db } = require('../db/database');

let bot = null;

function botEnabled() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.ADMIN_CHAT_ID);
}

function startBot() {
  if (!botEnabled()) {
    console.log('Telegram-бот не настроен (TELEGRAM_BOT_TOKEN / ADMIN_CHAT_ID в .env). Одобрение через веб-админку.');
    return;
  }
  try {
    const { Telegraf, Markup } = require('telegraf');
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    bot.action(/approve:(\d+)/, (ctx) => {
      const id = parseInt(ctx.match[1], 10);
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'pending'").get(id);
      if (!u) return ctx.answerCbQuery('Заявка уже обработана');
      db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
      ctx.editMessageText(`✅ Пользователь ${u.name} (${u.email}) одобрен.`);
      ctx.answerCbQuery('Одобрено');
    });

    bot.action(/reject:(\d+)/, (ctx) => {
      const id = parseInt(ctx.match[1], 10);
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'pending'").get(id);
      if (!u) return ctx.answerCbQuery('Заявка уже обработана');
      db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(id);
      ctx.editMessageText(`❌ Пользователь ${u.name} (${u.email}) отклонен.`);
      ctx.answerCbQuery('Отклонено');
    });

    bot.launch().then(() => console.log('Telegram-бот запущен.'));
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (e) {
    console.error('Ошибка запуска Telegram-бота:', e.message);
  }
}

/** Уведомление админа о новой регистрации */
function notifyNewRegistration(user) {
  if (!bot || !botEnabled()) return;
  const { Markup } = require('telegraf');
  const text =
    `🔔 Новая регистрация\n\n` +
    `Имя: ${user.name}\n` +
    `Email: ${user.email}\n` +
    `Компания: ${user.company || '—'}\n` +
    `Телефон: ${user.phone || '—'}\n\n` +
    `Одобрить доступ?`;
  bot.telegram.sendMessage(process.env.ADMIN_CHAT_ID, text, {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('✅ Одобрить', `approve:${user.id}`),
       Markup.button.callback('❌ Отклонить', `reject:${user.id}`)]
    ]).reply_markup
  }).catch(e => console.error('Telegram send error:', e.message));
}

module.exports = { startBot, notifyNewRegistration, botEnabled };