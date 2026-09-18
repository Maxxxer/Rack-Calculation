/**
 * Rack Calculation — веб-приложение для расчета холодильных агрегатов.
 * Express + SQLite (node:sqlite) + EJS + Telegram-бот подтверждения регистраций.
 */
'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');

const { db } = require('./db/database');
const { startBot } = require('./bot/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Конфигурация ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Хелпер шаблонов: дюймовые размеры в «трубной» записи (2.125 → 2 1/8"), см. services/inch.js
app.locals.inch = require('./services/inch').formatInch;
// Гидравлическая схема собирается из результата расчёта в шаблонах
app.locals.buildSchematic = require('./services/schematic').buildSchematic;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));
// Явная установка UTF-8 для динамических ответов (корректная кодировка в формах авторизации).
// Важно: только после express.static и только если тип ещё не задан, иначе CSS/JS отдадутся как text/html.
app.use((req, res, next) => {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
  }
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || 'rack-calc-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 дней
}));

// ---------- Middleware ----------
// res.locals.user — текущий пользователь для всех шаблонов
// res.locals.currentPath — путь текущего запроса: шапка подсвечивает активный
// пункт навигации (aria-current="page") без правок в каждом шаблоне.
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.user = null;
  if (req.session.userId) {
    const u = db.prepare('SELECT id, email, name, role, status, discount_percent, company FROM users WHERE id = ?').get(req.session.userId);
    if (u && u.status === 'active') res.locals.user = u;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!res.locals.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!res.locals.user || res.locals.user.role !== 'admin') return res.status(403).render('error', { message: 'Доступ только для администратора' });
  next();
}
app.locals.requireAuth = requireAuth;
app.locals.requireAdmin = requireAdmin;

// ---------- Маршруты ----------
app.use('/', require('./routes/auth'));
app.use('/calc', requireAuth, require('./routes/calc'));
app.use('/quotes', requireAuth, require('./routes/quotes'));
app.use('/admin', requireAdmin, require('./routes/admin'));

app.get('/', (req, res) => {
  if (res.locals.user) return res.redirect('/calc');
  res.redirect('/login');
});

// 404
app.use((req, res) => res.status(404).render('error', { message: 'Страница не найдена' }));

// Ошибки
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: err.message || 'Внутренняя ошибка сервера' });
});

// ---------- Запуск ----------
app.listen(PORT, () => {
  console.log(`Rack Calculation запущен: http://localhost:${PORT}`);
  console.log('Администратор по умолчанию: admin@local / admin123');
});

// Telegram-бот (не блокирует запуск, если токен не задан)
startBot();
