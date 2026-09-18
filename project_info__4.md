# Rack Calculation — фронтенд и фирменный стиль (аудит перед редизайном)

> ⚠️ **Я в режиме Explore** — это режим исследования кода. Задача «переверстать сайт» — это **изменение кода**, и здесь оно не выполняется. Ниже — полный аудит UI-слоя, чтобы редизайн можно было сделать в **Act Mode** без сюрпризов. Отчёт сохранён в `project_info__3.md`.

---

## Summary

`Rack Calculation` — внутреннее веб-приложение для подбора и расчёта холодильных агрегатов компании **MAIR**. Пользователи: инженеры-подборщики (роль `client`) и администраторы (каталог, импорт Excel, утверждение КП).

Стек: **Node.js + Express 4 + SQLite (`node:sqlite`) + EJS (SSR, без сборки и без клиентского бандла) + Telegram-бот**. JS-файлов в `public/` нет вообще — весь клиентский JS инлайном в шаблонах.

**Ключевой факт для редизайна:** визуальный слой — ровно один файл `public/css/style.css` (~350 строк, подключается через `views/partials/header.ejs`), плюс **один автономный «остров»** — `views/quote-print.ejs` (печатное КП) со своим полностью независимым `<style>` и **другой синевой**: `#0b5fa5` вместо `#173F6D`.

---

## Фирменная палитра (фактическая, из кода)

### Источник 1 — логотип (первоисточник)

| Где | Значение | Комментарий |
|---|---|---|
| `public/assets/logo-mair.svg` → `.fil0 { fill:#173F6D }` | `#173F6D` | Тёмно-синий. Экспорт CorelDRAW — **исходный фирменный цвет** |
| `public/assets/logo-mair-wordmark.svg` | `currentColor` | Более новая версия: цвет наследуется от текста — удобно перекрашивать через `color` |

### Источник 2 — CSS-токены (`public/css/style.css`, `:root`)

| Токен | Значение | Назначение |
|---|---|---|
| `--brand` | `#173F6D` | Основной фирменный (совпадает с логотипом) |
| `--brand-2` | `#2E6FB7` | Акцентный синий; `--primary` = он же |
| `--brand-3` | `#4E8FD9` | Светлый: hover, скроллбар, бордеры выбранного |
| `--brand-glow` | `rgba(46,111,183,.35)` | Тень-свечение под кнопками |
| `--primary-dark` | `#173F6D` | |
| `--success` | `#16a34a` | |
| `--danger` | `#dc2626` | |
| `--warn` | `#d97706` | |

Полутона вручную (не токены): `#eaf2fb`, `#f1f6fc`, `#eef4fb`, `#f4f8fd`, `#fafcfe`, `#eaf0f7`, `#f4f7fb`, `#c3d2e5`, `#bcd8f7`, `#e2e8f0`.

### ⚠️ Расхождение палитры

`views/quote-print.ejs` использует **другой синий `#0b5fa5`** (`.doc-head`, `.doc-brand`, `.doc-num h2`, `h3`, `.totals tr.total`, `.btn-print`). Он **не совпадает** ни с `--brand`, ни с `--brand-2`. То есть печатное КП, уходящее клиенту, — в старом синем, а веб — в новом. Плюс `views/quotes.ejs` содержит инлайновый `<style>` со своей мини-палитрой статусов, не связанной с `--success`/`--danger`.

---

## Архитектура фронтенда

```
Express (server.js)
  app.set('view engine', 'ejs')
  app.use(express.static('public'))        ← /css/style.css, /assets/*.svg
  res.locals.user = {...}                  ← проброс пользователя во все шаблоны
        │
        └─► res.render('calc', {...})
                 └─► views/calc.ejs
                       ├── include('partials/header', { title })
                       │      └── <link rel="stylesheet" href="/css/style.css">   ← ЕДИНСТВЕННАЯ точка подключения CSS
                       ├── ... разметка ...
                       └── include('partials/footer')
```

Особенности:
- **Ни одной точки сборки.** Нет webpack/vite/npm-скриптов для CSS. CSS правится и отдаётся как есть.
- **Шаблоны — EJS** через `<%- include(..., {...}) %>`. Партиалы: `header`, `footer`, `vibration-table`.
- **Активный пункт меню не подсвечивается** — в `header.ejs` все ссылки одинаковые, нет `res.locals.currentPath`.
- **Клиентский JS — инлайн** (`onchange="toggleMode()"` в `calc.ejs`). В `public/` только `assets/` и `css/`.
- **Один `header.ejs`** обслуживает и авторизованные страницы, и вход/регистрацию: навигация обёрнута в `<% if (user) { %>`. Поэтому `login.ejs` / `register.ejs` / `error.ejs` тоже получают тёмный sticky-навбар.

---

## Структура (релевантное для UI)

```
Rack Calculation/
├── server.js                      — Express, static('/public'), res.locals.user, 404/500 → error.ejs
├── public/
│   ├── css/
│   │   └── style.css              ★ ЕДИНСТВЕННЫЙ глобальный стиль (~350 строк)
│   └── assets/
│       ├── logo-mair.svg          — логотип+подпись (CorelDRAW, fill:#173F6D), viewBox 21000×29700 (!)
│       ├── logo-mair-wordmark.svg — только «MAIR», fill:currentColor, viewBox 2900 4288 12345 2774
│       └── _brand/                — 9 исходных JPG (img_89…img_122) — сырьё дизайнера, в вёрстке не используется
├── assets/
│   └── лого MAIR.svg              — дубликат логотипа вне public/ (вебом не отдаётся)
└── views/
    ├── partials/
    │   ├── header.ejs             ★ <head> + sticky-навигация + открытие <main class="container">
    │   ├── footer.ejs             — закрытие </main> + <footer>
    │   └── vibration-table.ejs    — таблица виброгасителей (только разметка)
    ├── calc.ejs        ★ главная: форма из 3 секций + 6 блоков результатов
    ├── login.ejs / register.ejs / error.ejs   — используют .auth-card
    ├── quotes.ejs      — список КП; содержит ИНЛАЙНОВЫЙ <style> со статусами
    ├── quote-view.ejs  — просмотр КП (grid-2, card, kv, table)
    ├── quote-print.ejs ★ АВТОНОМНЫЙ документ: свой <style>, свой doctype, не подключает style.css
    ├── production.ejs  — производственная спецификация (fieldset.card + legend)
    ├── admin-users.ejs — статус-бейджи БЕЗ определения стилей (см. ниже)
    ├── admin-import.ejs
    └── admin-catalog.ejs
```

---

## Дизайн-система: что уже есть в `style.css`

CSS уже написан в «токенном» стиле — это сильно упрощает редизайн: достаточно переписать `:root` и несколько компонентов.

### Токены (`:root`)

```css
/* Бренд */      --brand, --brand-2, --brand-3, --brand-glow, --primary, --primary-dark
/* Семантика */  --success, --danger, --warn
/* Поверхности */--bg, --bg-accent, --card, --border, --text, --muted
/* Формы */      --radius: 14px, --radius-sm: 10px
/* Тени */       --shadow-sm / -md / -lg, --ring
/* Градиент */   --grad: linear-gradient(135deg, brand → brand-2 55% → brand-3)
/* Анимация */   --ease: cubic-bezier(.4,0,.2,1)
```

### Компоненты, реализованные в CSS

| Класс | Что это |
|---|---|
| `.topnav`, `.brand`, `.brand-logo`, `.brand-text`, `.nav-links`, `.user-info`, `.btn-link` | Sticky-шапка со стеклянным эффектом (`backdrop-filter: blur(14px) saturate(160%)`), фон `rgba(23,63,109,.85)` |
| `.container` | `max-width: 1240px`, `flex: 1` (прижимает футер вниз) |
| `.card`, `.card-title`, `fieldset.card`, `legend` | Карточки; заголовок с градиентной нижней границей через `border-image` |
| `.grid-2` | Двухколоночная сетка → одна колонка на `max-width: 900px` |
| `.form-group`, `.form-row`, `.hint` | Формы; `.form-row` — жёсткая сетка 1fr/1fr **без медиа-запроса** |
| `.radio`, `label.option-item` | Строки выбора/чекбоксы; состояние «выбрано» через `:has(input:checked)` |
| `.options-grid` | `repeat(auto-fill, minmax(320px,1fr))` |
| `.badge` | Градиентная «пилюля» («обязательная опция») |
| `.btn`, `.btn-primary/-success/-danger`, `.btn-lg/-sm/-block`, `.actions` | Кнопки с градиентами и свечением |
| `.table`, `.kv`, `.total-row`, `.grand-row` | Таблицы; `.kv` — «ключ-значение» для карточек стоимости |
| `.alert`, `.alert-error/-success/-warn` | Алерты с левой границей 4px |
| `.auth-card`, `.auth-hint` | Центрированная карточка входа с градиентной полосой `::before` |
| `.price-card`, `details/summary` | Прочие детали |
| `::-webkit-scrollbar-*` | Кастомный скроллбар (`#c3d2e5` → `--brand-3` при hover) |
| `@media print` | Скрывает `.topnav`, `.footer`, `.actions`, `.no-print` |

### Что уже соответствует «современным трендам»
Токенизация цветов/радиусов/теней · Glassmorphism в шапке · Градиентные кнопки и заголовки · Крупный радиус (14px) и мягкие многослойные тени · `:has()` без JS · `accent-color` для нативных чекбоксов · Единая кривая `--ease` · Радиальный фоновый градиент («свет из угла»).

### Чего нет (потенциал редизайна)
**Тёмная тема отсутствует полностью** (при том что комментарий в файле гласит `Modern UI`). Нет `btn-secondary` / `btn-outline` — есть только primary/success/danger. Нет spacing-токенов (все `margin`/`padding` хардкодом). Нет типографической шкалы. Нет `:disabled`, `:focus-visible`, `loading`-состояний. Нет skeleton/empty-state. **Иконок нет** — везде эмодзи (`🖨`, `✅`, `❌`, `🏭`, `💾`, `⬇`, `⚠`, `★`).

---

## Ключевые находки (неочевидное)

### 1. ⚠️ Шрифт `Inter` объявлен, но никогда не загружается
```css
body { font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; }
```
В `views/partials/header.ejs` **нет ни `<link>` на Google Fonts, ни `@font-face`**, в `public/` нет файлов шрифтов. Значит фактически сайт всегда рендерится в **Segoe UI** / системном шрифте. `'Inter'` — «мёртвая» первая ступень стека.

### 2. ⚠️ Печатное КП живёт в другой дизайн-системе
`views/quote-print.ejs` — **самостоятельный HTML-документ**: свой `<!DOCTYPE>`, свой `<style>`, **не подключает** `/css/style.css` и не включает партиалы. Последствия: другой синий (`#0b5fa5`), другой шрифт (`'Segoe UI', Arial`), другие радиусы (`6px` vs `14px`), таблицы `border-collapse: collapse` с рамками `#d1d5db`, а логотип в шапке — **просто текст «MAIR»**, SVG не используется. Это главный клиентский артефакт (КП уходит заказчику) — оставить «как есть» нельзя.

### 3. ⚠️ Статус-бейджи в админке не имеют стилей
Классы статусов определены **только внутри `views/quotes.ejs`** (инлайновый `<style>`): `.status-draft / .status-sent / .status-approved / .status-rejected`. Но `views/admin-users.ejs` использует `<span class="status status-<%= u.status %>">` со значениями `pending` / `active` / `rejected`, причём:
- `admin-users.ejs` **не включает** тот инлайновый блок (он есть только на `/quotes`) → на `/admin/users` класс `.status` вообще не определён и бейдж рендерится как обычный текст;
- классов `.status-pending` и `.status-active` **не существует нигде**.

Это реальный визуальный дефект, который стоит закрыть при редизайне.

### 4. `filter: brightness(0) invert(1)` на логотипе в шапке
```css
.brand-logo { height: 34px; filter: brightness(0) invert(1); }
```
Логотип принудительно белый. То есть **в навбаре фирменный цвет логотипа не виден вообще** — он существует только в SVG-файле. Фирменный цвет «проявляется» лишь в градиентах `h1` и кнопок.

### 5. Заголовки `h1` — текст с `background-clip: text`
```css
h1 { background: linear-gradient(90deg, var(--brand), var(--brand-2)); -webkit-text-fill-color: transparent; }
```
В `@media print` есть **явный откат**: `h1 { color: var(--brand); -webkit-text-fill-color: var(--brand); }`. Это не случайность — автор сознательно предусмотрел потерю градиента при печати. Аналогично `body { background: #fff }` в print-блоке гасит `--bg-accent` + `background-attachment: fixed`.

### 6. `viewBox` у `logo-mair.svg` — размером с A4
`viewBox="0 0 21000 29700"`, `width="210mm" height="297mm"` — это **экспорт CorelDRAW целой страницы A4**, а не обрезанный логотип. Масштабирование/центрирование ненадёжно. Соблазн при редизайне: использовать `logo-mair-wordmark.svg` (аккуратный `viewBox="2900 4288 12345 2774"`, `fill="currentColor"`).

### 7. `:has()` — единственный приём с ограниченной поддержкой
`.radio:has(input:checked)` / `label.option-item:has(input:checked)` дают подсветку выбранной строки без JS. В браузерах без поддержки (Firefox < 121, Safari < 15.4) подсветки не будет — деградация только визуальная, функциональность input не страдает.

### 8. «Зелёный» и «красный» имеют по 2+ оттенка
Токены `--success: #16a34a` / `--danger: #dc2626` и статусы в `quotes.ejs` (`#d1fae5`/`#065f46`, `#fee2e2`/`#991b1b`) — разные палитры.

### 9. Мобильная вёрстка ломается в двух местах
`options-grid` требует минимум 320px + внутренние отступы — на узких экранах (<360px) строки сжимаются/переполняются. `.form-row` — жёсткая сетка `1fr 1fr` **без медиа-запроса** (в отличие от `.grid-2`).

### 10. Инлайн-стили как «заплатки» (инвентарь)

| Файл | Инлайн-стиль | Зачем |
|---|---|---|
| `views/calc.ejs` | `style="display:none"` на `#manualBlock` | Скрытие блока ручного выбора; переключает JS `toggleMode()` |
| `views/production.ejs` | `style="max-width:480px"` на `.kv` | Ограничение ширины таблицы калькуляции |
| `views/admin-users.ejs` | `style="width:70px"` на input | Ширина поля скидки |
| `views/admin-import.ejs` | `style="margin-left:20px; margin-bottom:10px"` на `<ul class="hint">` | Отступ списка |
| `views/quotes.ejs` | `<style>` со статусами | Полноценный отдельный блок |

### 11. Доступность (a11y) — системные пробелы
- `<label>` **не связаны** с инпутами ни через `for`/`id`, ни через оборачивание → клик по подписи не фокусирует поле, скринридер не связывает их.
- Иконки — эмодзи без `aria-hidden` (🏭 читается как «еда»).
- `lang="ru"` есть ✔ (в `header.ejs` и `quote-print.ejs`).
- Нет `:focus-visible` на `.btn`, ссылках навигации, `.btn-link` (только `input/select` получают `--ring`).
- У `.alert`/`.status` нет `role="status"`/`aria-live`.
- `.brand-logo` с `alt="MAIR"` + дублирующий текстовый `.brand-text` — избыточность для скринридера.

### 12. `header.ejs` не передаёт признак активного раздела
Навигация статична, **активный пункт не подсвечен**. Для редизайна почти наверняка потребуется пробросить текущий путь (`res.locals` в `server.js` или локальная переменная в каждом `include`).

### 13. Нет ни одной JS-зависимости во фронтенде
`public/` = `css/` + `assets/`. Ни одного `.js`. Все интерактивные штуки — инлайн-скрипты в шаблонах. Значит **нет риска «сломать бандл»** при правке вёрстки, но и нет простого способа добавить сложное поведение.

### 14. Два независимых механизма печати
- `style.css` → `@media print { .topnav, .footer, .actions, .no-print { display: none } }` — для страниц приложения.
- `quote-print.ejs` → свой `@media print { .btn-print { display: none } body { padding: 0 } }`.

В `quote-view.ejs` кнопка `.no-print` ведёт на `/print` — **`.no-print` обязан сохраниться** при объединении стилей.

### 15. `.status` в `quotes.ejs` — единственный компонент вне системы
Перенос статус-бейджей в `style.css` (с токенами `--success`, `--warn`, `--danger`, `--muted`) — очевидный шаг консолидации, который заодно починит дефект из п. 3.

---

## Поток данных (UI-контекст)

1. `GET /calc` → `server.js` → middleware `res.locals.user` (запрос к `users`) → `routes/calc.js` → `res.render('calc', { options, manufacturers, result, isAdmin, ... })`.
2. `views/calc.ejs` → `include('partials/header')` (получает `user` из `res.locals`) → генерирует `<link rel="stylesheet" href="/css/style.css">` → форма.
3. При наличии `result` — тот же шаблон рендерит 6 блоков: характеристики, свойства хладагента, компрессоры, трубопроводы, виброгасители (`partials/vibration-table`), спецификация, стоимость (`.card.price-card`).
4. `isAdmin` управляет видимостью разбивки цены (материалы / мелочь 5% / работы 30% / профит 15%). **Клиент видит только итоговую цену** — ключевая UI-инварианта: вся внутренняя калькуляция обёрнута в `<% if (isAdmin) %>`.
5. «Сохранить как КП» → POST `/calc` → `routes/quotes.js` → редирект на `/quotes/:number`.
6. Печать: `quote-view.ejs` → `/quotes/:number/print` (`target="_blank"`) → `views/quote-print.ejs` (автономный документ).

---

## Приоритеты редизайна (карта работ)

**Уровень 1 — консолидация (без риска):**
1. Перенести `.status*` из `<style>` в `quotes.ejs` → `public/css/style.css`; добавить отсутствующие `.status-pending`, `.status-active` → попутно чинит `/admin/users`.
2. Свести `quote-print.ejs` к фирменной палитре (`#0b5fa5` → `--brand`/`--brand-2`) или вынести его стили в `public/css/print.css` с теми же токенами.
3. Решить судьбу `'Inter'` — реально подключить или убрать из стека.

**Уровень 2 — систематизация:**
4. Spacing- и typography-токены (`--space-*`, `--text-*`).
5. `btn-secondary`/`btn-ghost`, `:focus-visible`, `:disabled`.
6. Индикатор активного пункта меню (`res.locals.currentPath` + `.nav-links a.is-active`).
7. Заменить инлайн-стили (п. 10) на классы-утилиты.

**Уровень 3 — современные тренды:**
8. Тёмная тема через `@media (prefers-color-scheme: dark)` или `[data-theme]` — все цвета уже токенизированы, это большой плюс.
9. Иконки вместо эмодзи (инлайн-SVG-спрайт; `logo-mair-wordmark.svg` с `currentColor` — образец подхода).
10. Мобильная адаптация: `.form-row` → `1fr` на `<560px`, `options-grid` → `minmax(0,1fr)`.
11. a11y: связать `label`/`input` через `for`/`id`, `role="status"` на `.alert`, `aria-hidden` на декоративных иконках, `aria-current="page"` на активном пункте.

**⚠️ Чего делать нельзя (сломает функциональность):**
- Удалять `.no-print` / `@media print` — сломается печать КП.
- Удалять `#autoBlock` / `#manualBlock` и `id="calcForm"` — их использует инлайн-JS в `calc.ejs`.
- Менять способ подключения `<%- include('partials/header', { title }) %>` — `title` идёт в `<title>`.
- Удалять `<% if (user) %>` в `header.ejs` — навигация перестанет отличать гостя от пользователя.
- Переименовывать классы, не проверив все 12 шаблонов.

---

## Module Reference (UI-слой)

| Файл | Назначение |
|---|---|
| `public/css/style.css` | ★ Единственный глобальный стиль: токены `:root`, шапка, карточки, формы, кнопки, таблицы, алерты, auth-card, скроллбар, `@media print` |
| `views/partials/header.ejs` | `<!DOCTYPE>` + `<head>` + `<link>` на CSS + sticky-навбар (`.topnav`) + открытие `<main class="container">` |
| `views/partials/footer.ejs` | Закрытие `</main>` + `<footer class="footer">` |
| `views/partials/vibration-table.ejs` | Таблица виброгасителей; наследует `.table`, `.hint`; колонка «Цена» — только админу |
| `views/calc.ejs` | ★ Главная: форма из 3 секций (`.card` × 3 в `.grid-2`), `.options-grid` с `.option-item`/`.badge`, 6 блоков результатов |
| `views/login.ejs` | `.auth-card` + `.alert-error` + `btn-primary btn-block` |
| `views/register.ejs` | Тот же `.auth-card`, 5 полей, состояние `success` |
| `views/error.ejs` | `.auth-card` + эмодзи `⚠` в `h1` |
| `views/quotes.ejs` | Таблица КП + **инлайновый `<style>` со `.status*`** |
| `views/quote-view.ejs` | Просмотр КП: `.grid-2`, `.card`, `.card-title`, `.kv`, `.grand-row`, `.actions.no-print` |
| `views/quote-print.ejs` | ★ **Автономный документ**: свой `<style>`, палитра `#0b5fa5`, `border-collapse: collapse`, `.btn-print` |
| `views/production.ejs` | `fieldset.card` + `legend`, BOM-таблица, инлайн `style="max-width:480px"` |
| `views/admin-users.ejs` | Таблица пользователей, `.status-<%= u.status %>` **без стилей**, инлайн `style="width:70px"` |
| `views/admin-import.ejs` | Форма загрузки xlsx, `fieldset.card`, инлайн-отступы на `<ul class="hint">` |
| `views/admin-catalog.ejs` | `fieldset.card` по категориям + `.table` |
| `public/assets/logo-mair.svg` | Логотип+подпись, `fill:#173F6D`, но `viewBox` как у A4 — неудобен для масштабирования |
| `public/assets/logo-mair-wordmark.svg` | «MAIR» без подписи, `fill="currentColor"` — ★ предпочтительный вариант для новой шапки |
| `public/assets/_brand/img_*.jpg` | 9 исходных изображений бренда — сырьё, в вёрстке не используется |
| `assets/лого MAIR.svg` | Дубликат логотипа вне `public/` (вебом не отдаётся) |

---

## Suggested Reading Order

1. `public/css/style.css` — **начать здесь**: весь визуальный словарь в одном файле, включая фирменные токены `--brand: #173F6D` / `--brand-2: #2E6FB7`.
2. `views/partials/header.ejs` — единственная точка подключения CSS; `header`/`footer` общие для всех страниц.
3. `views/calc.ejs` — самая большая и важная страница: 90% компонентов дизайн-системы встречаются именно тут.
4. `views/quote-print.ejs` — второй, автономный дизайн-слой и расхождение по синему `#0b5fa5`.
5. `views/quotes.ejs` — инлайновые статус-стили, которые нужно консолидировать.
6. `views/admin-users.ejs` — дефект неопределённых `.status-pending` / `.status-active`.

---

## Что дальше

Задача «переверстать сайт с учётом современных трендов и фирменных цветов» — это **изменение кода** (правка `public/css/style.css`, `views/partials/header.ejs`, `views/quote-print.ejs`, `views/quotes.ejs` и связанных шаблонов).

Я в **Explore Mode** — режим исследования кода: могу анализировать и документировать, но не вносить изменения. Чтобы реализовать редизайн, **переключитесь в Act Mode** селектором режима внизу чата. Этот отчёт (`project_info__3.md` + текст выше) переносится в контекст Act Mode, так что начинать с нуля не придётся: палитра, инвентарь стилей, карта дефектов и приоритеты работ уже собраны.

📄 Сохранено: `d:\YandexDisk\!MAIR\Разработка\Rack Calculation\project_info__3.md`