/**
 * Маршруты аутентификации: вход, саморегистрация, выход.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { notifyNewRegistration } = require('../bot/telegram');

/**
 * Срок жизни сессии при включённой галочке «Запомнить меня» — 30 дней.
 * Без галочки ставится сессионная cookie: она живёт до закрытия браузера,
 * что и ожидается от «обычного» входа на общем компьютере.
 */
const REMEMBER_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const emailValue = String(email || '').trim();
  const remember = req.body.remember === 'on' || req.body.remember === 'true' || req.body.remember === '1';
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(emailValue.toLowerCase());
  const renderError = (error) => res.render('login', { error, email: emailValue, remember });

  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return renderError('Неверный email или пароль');
  }
  if (u.status === 'pending') {
    return renderError('Регистрация ожидает подтверждения администратором');
  }
  if (u.status === 'rejected') {
    return renderError('Регистрация отклонена администратором');
  }

  req.session.userId = u.id;
  if (remember) {
    req.session.cookie.maxAge = REMEMBER_MAX_AGE_MS;
  } else {
    // Сессионная cookie: живёт до закрытия браузера
    req.session.cookie.maxAge = null;
    req.session.cookie.expires = null;
  }
  res.redirect('/calc');
});

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', (req, res) => {
  const { email, password, name, company, phone } = req.body;
  const em = String(email || '').trim().toLowerCase();
  if (!em || !password || !name) {
    return res.render('register', { error: 'Заполните email, пароль и имя' });
  }
  if (password.length < 6) {
    return res.render('register', { error: 'Пароль должен быть не короче 6 символов' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(em);
  if (exists) {
    return res.render('register', { error: 'Пользователь с таким email уже зарегистрирован' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (email, password_hash, name, company, phone, role, status)
    VALUES (?,?,?,?,?, 'client', 'pending')`).run(em, hash, name.trim(), company || '', phone || '');
  const user = { id: info.lastInsertRowid, name: name.trim(), email: em, company, phone };
  notifyNewRegistration(user); // уведомление админу в Telegram (если настроен)
  res.render('register', { error: null, success: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
