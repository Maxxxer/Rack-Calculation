/**
 * Маршруты аутентификации: вход, саморегистрация, выход.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { notifyNewRegistration } = require('../bot/telegram');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.render('login', { error: 'Неверный email или пароль' });
  }
  if (u.status === 'pending') {
    return res.render('login', { error: 'Регистрация ожидает подтверждения администратором' });
  }
  if (u.status === 'rejected') {
    return res.render('login', { error: 'Регистрация отклонена администратором' });
  }
  req.session.userId = u.id;
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