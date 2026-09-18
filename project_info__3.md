# Rack Calculation — фронтенд и фирменный стиль (аудит перед редизайном)

> **Режим Explore.** Отчёт носит исследовательский характер: это карта текущего UI-слоя, фирменной палитры и всех мест, где стили живут, чтобы редизайн можно было выполнить без сюрпризов. Реализация (правка CSS/EJS) в этом режиме не выполняется — см. раздел «Что дальше» в конце.

---

## Summary

`Rack Calculation` — внутреннее веб-приложение для подбора и расчёта холодильных агрегатов (компрессорно-ресиверных блоков) компании **MAIR**. Пользователи: инженеры-подборщики (роль `client`) и администраторы, которые ведут каталог оборудования, импортируют каталоги из Excel и утверждают коммерческие предложения.

Стек: **Node.js + Express 4 + SQLite (`node:sqlite`) + EJS (SSR, без сборки и без клиентского бандла) + Telegram-бот**. Вся вёрстка — серверный рендеринг EJS-шаблонов + один глобальный CSS-файл. JS-файлов в `public/` нет вовсе — весь клиентский JS встроен инлайном в шаблоны.

**Ключевой факт для редизайна:** визуальный слой — это ровно один файл `public/css/style.css` (~350 строк, загружается через `views/partials/header.ejs`), плюс **один автономный «остров»** — `views/quote-print.ejs` (печатная форма КП) со своим полностью независимым `<style>` и **другой фирменной синевой** (`#0b5fa5` вместо `#173F6D`).

---

## Фирменная палитра (фактическая, из кода)

Цвета восстановлены из двух источников: SVG-логотипа и CSS-токенов.

### Источник 1 — логотип (первоисточник)

| Где | Значение | Комментарий |
|---|---|---|
| `public/assets/logo-mair.svg` → `.fil0 { fill:#173F6D }` | `#173F6D` | Тёмно-синий. Экспорт из CorelDRAW, это **исходный фирменный цвет** |
| `public/assets/logo-mair-wordmark.svg` | `currentColor` | Более новая версия: цвет наследуется от текста (удобно для редизайна — можно перекрасить через `color`) |

### Источник 2 — CSS-токены (`public/css/style.css`, блок `:root`)

| Токен | Значение | Назначение |
|---|---|---|
| `--brand` | `#173F6D` | Основной фирменный (совпадает с логотипом) |
| `--brand-2` | `#2E6FB7` | Акцентный синий; `--primary` = он же |
| `--brand-3` | `#4E8FD9` | Светлый синий: hover-состояния, скроллбар, бордеры выбранного |
| `--brand-glow` | `rgba(46,111,183,.35)` | Тень-свечение под кнопками |
| `--primary-dark` | `#173F6D` | |
| `--success` | `#16a34a` | |
| `--danger` | `#dc2626` | |
| `--warn` | `#d97706` | |

Полутóна, выведенные вручную (не токены, а хардкод): `#eaf2fb`, `#f1f6fc`, `#eef4fb`, `#f4f8fd`, `#fafcfe`, `#eaf0f7`, `#f4f7fb`, `#c3d2e5`, `#bcd8f7`, `#e2e8f0`.

### ⚠️ Расхождение палитры (важно!)

`views/quote-print.ejs` использует **другой синий**: `#0b5fa5` (для `.doc-head`, `.doc-brand`, `.doc-num h2`, `h3`, `.totals tr.total`, `.btn-print`). Этот оттенок **нигде не совпадает** ни с `--brand`, ни с `--brand-2`. То есть печатное КП, которое уходит клиенту, выдержано в старом синем, а веб-интерфейс — в новом. При редизайне это первое, что нужно унифицировать.

Также `views/quotes.ejs` содержит инлайновый `<style>` со своей мини-палитрой статусов (нейтральный/голубой/зелёный/красный), не связанной с токенами `--success`/`--danger`.

---

## Архитектура фронтенда

```
Express (server.js)
  app.set('view engine', 'ejs')
  app.use(express.static('public'))        ← /css/style.css, /assets/*.svg
  res.locals.user = {...}                  ← проброс пользователя во все шаблоны
        │
        └─► res.render('calc', {...})
                 │
                 └─► views/calc.ejs
                       ├── include('partials/header', { title })
                       │      └── <link rel="stylesheet" href="/css/style.css">   ← ЕДИНСТВЕННАЯ точка подключения CSS
                       ├── ... разметка страницы ...
                       └── include('partials/footer')
```

Особенности:

- **Ни одной точки сборки.** Нет webpack/vite/npm-скриптов для CSS. CSS правится и отдаётся как есть.
- **Шаблонизация — EJS через `<%- include(..., {...}) %>`.** Частичные шаблоны: `header`, `footer`, `vibration-table`. Локальные переменные передаются вторым аргументом.
- **Класс активной страницы в навигации не подсвечивается** — в `header.ejs` все ссылки одинаковые, активный пункт никак не выделен (нет `res.locals.currentPath`).
- **Клиентский JS — инлайн** в шаблонах (например `onchange="toggleMode()"` в `calc.ejs`). Директория `public/` содержит только `assets/` и `css/`.
- **Один и тот же `header.ejs`** обслуживает и авторизованные страницы (`calc`, `quotes`, `admin-*`), и страницы входа/регистрации: навигация просто оборачивается в `<% if (user) { %>`. Поэтому `login.ejs` / `register.ejs` / `error.ejs` тоже получают тёмный sticky-навбар.

---

## Структура (только релевантное для UI)

```
Rack Calculation/
├── server.js                      — Express, static('/public'), res.locals.user, 404/500 → error.ejs
├── public/
│   ├── css/
│   │   └── style.css              ★ ЕДИНСТВЕННЫЙ глобальный стиль (~350 строк)
│   └── assets/
│       ├── logo-mair.svg          — логотип с подписью (CorelDRAW, fill:#173F6D), viewBox 21000×29700 (!)
│       ├── logo-mair-wordmark.svg — только начертание «MAIR», fill:currentColor, viewBox 2900 4288 12345 2774
│       └── _brand/                — 9 исходных JPG (img_89…img_122) — сырьё дизайнера, не используется в вёрстке
├── assets/
│   └── лого MAIR.svg              — дубликат логотипа вне public/ (используется только скриптами, не вебом)
└── views/
    ├── partials/
    │   ├── header.ejs             ★ <head> + sticky-навигация + открытие <main class="container">
    │   ├── footer.ejs             — закрытие </main> + <footer>
    │   └── vibration-table.ejs    — таблица виброгасителей (только разметка, стили из .table)
    ├── calc.ejs        ★ главная страница: большая форма (3 секции) + 6 блоков результатов
    ├── login.ejs / register.ejs / error.ejs   — используют .auth-card
    ├── quotes.ejs      — список КП; содержит ИНЛАЙНОВЫЙ <style> со статусами
    ├── quote-view.ejs  — просмотр КП (grid-2, card, kv, table)
    ├── quote-print.ejs ★ АВТОНОМНЫЙ документ: свой <style>, свой doctype, не подключает style.css
    ├── production.ejs  — производственная спецификация (fieldset.card + legend)
    ├── admin-users.ejs — таблица пользователей; статус-бейджи БЕЗ определения стилей (см. ниже)
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
| `.grid-2` | Двухколоночная сетка, сворачивается в одну на `max-width: 900px` |
| `.form-group`, `.form-row`, `.hint` | Формы; `.form-row` — сетка 1fr/1fr (на мобильных НЕ сворачивается — см. проблемы) |
| `.radio`, `label.option-item` | Строки выбора/чекбоксы; состояние «выбрано» через `:has(input:checked)` |
| `.options-grid` | `repeat(auto-fill, minmax(320px,1fr))` — адаптивная сетка опций |
| `.badge` | Градиентная «пилюля» (используется для «обязательная опция») |
| `.btn`, `.btn-primary/-success/-danger`, `.btn-lg/-sm/-block`, `.actions` | Кнопки с градиентами и `box-shadow` свечением |
| `.table`, `.kv`, `.total-row`, `.grand-row` | Таблицы; `.kv` — «ключ-значение» для карточек стоимости |
| `.alert`, `.alert-error/-success/-warn` | Алерты с цветной левой границей 4px |
| `.auth-card`, `.auth-hint` | Центрированная карточка входа с градиентной полосой `::before` сверху |
| `.price-card`, `details/summary` | Прочие детали |
| `::-webkit-scrollbar-*` | Кастомный скроллбар (`#c3d2e5` → `--brand-3` при hover) |
| `@media print` | Скрывает `.topnav`, `.footer`, `.actions`, `.no-print` |

### Что уже соответствует «современным трендам»

- Токенизация цветов/радиусов/теней
- Glassmorphism в шапке (backdrop-filter)
- Градиентные кнопки и заголовки
- Крупный радиус (14px), мягкие многослойные тени
- `:has()` для состояний выбора (без JS)
- `accent-color` для нативных чекбоксов
- Плавные переходы через единую кривую `--ease`
- Радиальный фоновый градиент (`--bg-accent`) — «свет из угла»

### Чего нет (потенциал редизайна)

- **Тёмная тема** отсутствует полностью — при том что комментарий в файле гласит `Modern UI`.
- **Кнопок-призраков (`btn-secondary` / `btn-outline`) нет** — есть только primary/success/danger. Любая нейтральная кнопка стилизуется «на месте».
- **Нет CSS custom properties для отступов** (spacing scale) — все `margin`/`padding` хардкодом.
- **Нет типографической шкалы** — размеры заданы напрямую (`1.7rem`, `1.05rem`, `.93rem`, `.85rem`…).
- **Нет состояний `:disabled`, `:focus-visible`, `loading`**.
- **Нет skeleton/empty-state паттернов** для таблиц.
- **Иконок нет** — везде эмодзи (`🖨`, `✅`, `❌`, `🏭`, `💾`, `⬇`, `⚠`, `★`).

---

## Ключевые находки (неочевидное)

### 1. ⚠️ Шрифт `Inter` объявлен, но никогда не загружается

```css
body { font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; }
```

В `views/partials/header.ejs` **нет ни `<link>` на Google Fonts, ни `@font-face`**, и в `public/` нет файлов шрифтов. Значит фактически сайт всегда рендерится в **Segoe UI** (Windows) / системном шрифте. `'Inter'` — «мёртвая» первая ступень стека. При редизайне это можно либо реализовать (подключить), либо честно убрать.

### 2. ⚠️ Печатная форма КП живёт в другой дизайн-системе

`views/quote-print.ejs` — это **самостоятельный HTML-документ**: свой `<!DOCTYPE>`, свой `<style>`, **не подключает** `/css/style.css` и не включает партиалы. Последствия:

- **Другой синий**: `#0b5fa5` вместо `#173F6D`.
- **Другой шрифт**: `'Segoe UI', Arial` вместо стека с `Inter`.
- **Другие радиусы**: `border-radius: 6px` (кнопка) vs `14px` в системе.
- Таблицы `border-collapse: collapse` с рамками `#d1d5db` — «документный» стиль, а не карточный.
- Логотип в шапке — просто **текст «MAIR»** (`<div class="doc-brand">MAIR</div>`), SVG не используется.

Это главный клиентский артефакт (КП уходит заказчику), поэтому при редизайне его нельзя оставить «как есть».

### 3. ⚠️ Статус-бейджи в админке не имеют стилей

Классы статусов определены **только внутри `views/quotes.ejs`** (инлайновый `<style>`):

```css
.status-draft / .status-sent / .status-approved / .status-rejected
```

Но `views/admin-users.ejs` использует `<span class="status status-<%= u.status %>">` со значениями `pending` / `active` / `rejected`. При этом:

- `views/admin-users.ejs` **не включает** тот инлайновый блок (он есть только на странице `/quotes`) → на `/admin/users` класс `.status` **вообще не определён** и бейдж рендерится как обычный текст.
- Даже если бы определение было — классов `.status-pending` и `.status-active` **не существует нигде**.

Это реальный визуальный дефект, который стоит закрыть при редизайне (перенос `.status*` в `style.css`).

### 4. `filter: brightness(0) invert(1)` на логотипе в шапке

```css
.brand-logo { height: 34px; filter: brightness(0) invert(1); }
```

Логотип принудительно делается белым. То есть **в навбаре фирменный цвет логотипа не виден вообще** — он существует только в SVG-файле. Фирменный цвет «проявляется» лишь в градиентах заголовка `h1` и кнопок.

### 5. Заголовки `h1` — текст с `background-clip: text`

```css
h1 { background: linear-gradient(90deg, var(--brand), var(--brand-2));
     -webkit-text-fill-color: transparent; }
```

Эффект красив, но: (а) `background-clip: text` — не во всех контекстах печати/скринридерах; (б) в `@media print` есть **явный откат**:

```css
@media print { h1 { color: var(--brand); -webkit-text-fill-color: var(--brand); } }
```

Это не случайность — автор сознательно предусмотрел потерю градиента при печати. Аналогично `--bg-accent` (радиальные градиенты) и `background-attachment: fixed` на `body` — при печати в Chrome/Firefox фон может исчезнуть; в print-блоке `body { background: #fff }` это уже учтено.

### 6. `viewBox` у `logo-mair.svg` — размером с A4

У логотипа `viewBox="0 0 21000 29700"` (пропорции 210×297 мм — страница A4) и `width="210mm" height="297mm"`. Это **экспорт CorelDRAW целой страницы**, а не обрезанный логотип. Масштабирование/центрирование такой SVG ненадёжно — соблазн при редизайне: использовать `logo-mair-wordmark.svg` (аккуратный `viewBox="2900 4288 12345 2774"` и `fill="currentColor"`).

### 7. Только один браузерный CSS-приём с ограниченной поддержкой — `:has()`

`.radio:has(input:checked)` и `label.option-item:has(input:checked)` дают подсветку выбранной строки **без JS**. В браузерах без поддержки `:has()` (Firefox < 121, Safari < 15.4) выбранное состояние просто не подсветится — это деградация только визуальная, функциональность (сам input) не страдает.

### 8. Все палитры «семантики» в `style.css` конфликтуют со статусами в `quotes.ejs`

Зелёный/красный в токенах (`#16a34a` / `#dc2626`) и зелёный/красный статусов (`#d1fae5`/`#065f46`, `#fee2e2`/`#991b1b`) — разные. То есть «зелёный» в интерфейсе имеет 2+ оттенка.

### 9. `options-grid` с `minmax(320px, 1fr)` ломает мобильную вёрстку

Карточка опций требует минимум 320px + внутренние отступы. На узких экранах (<360px с учётом padding контейнера) строки будут сжаты/переполнены. Аналогично `.form-row` — жёсткая сетка `1fr 1fr` без медиа-запроса (в отличие от `.grid-2`, у которого он есть).

### 10. Инлайн-стили как «заплатки» (инвентарь)

Места, где стили протекают из CSS в разметку — их стоит вычистить при редизайне:

| Файл | Инлайн-стиль | Зачем |
|---|---|---|
| `views/calc.ejs` | `style="display:none"` на `#manualBlock` | Скрытие блока ручного выбора; переключается JS-функцией `toggleMode()` |
| `views/production.ejs` | `style="max-width:480px"` на `.kv` | Ограничение ширины таблицы калькуляции |
| `views/admin-users.ejs` | `style="width:70px"` на input | Ширина поля скидки |
| `views/admin-import.ejs` | `style="margin-left:20px; margin-bottom:10px"` на `<ul class="hint">` | Отступ списка |
| `views/quotes.ejs` | `<style>` со статусами | Полноценный отдельный блок |

### 11. Доступность (a11y) — несколько системных пробелов

- `<label>` **не связаны** с инпутами ни через `for`/`id`, ни через оборачивание → клик по подписи не фокусирует поле, скринридер не связывает их.
- Иконки — эмодзи без `aria-hidden`, читаются как «печать/PDF», «еда» (🏭) и т.п.
- Нет `<html lang>` проблем — `lang="ru"` есть ✔ (в `header.ejs` и `quote-print.ejs`).
- Нет `:focus-visible`-стилей на `.btn`, ссылках навигации и `.btn-link` (только `input/select` получают `--ring`).
- У `.alert` и `.status` нет `role="status"`/`aria-live` — сообщения появляются без объявления.
- `.brand-logo` имеет `alt="MAIR"` ✔, а рядом дублирующий текстовый `.brand-text` — избыточность для скринридера.

### 12. `header.ejs` не передаёт признак активного раздела

Навигация статична: `<a href="/calc">`, `<a href="/quotes">`, `<a href="/admin/...">`. **Активный пункт не подсвечен**. При редизайне почти наверняка потребуется добавить проброс текущего пути (через `res.locals` в `server.js` или локальную переменную в каждом `<%- include('partials/header', {...}) %>`).

### 13. Нет ни одной JS-зависимости во фронтенде

`public/` = `css/` + `assets/`. Ни одного `.js`. Все интерактивные штуки (переключение auto/manual в `calc.ejs`) — инлайн-скрипты в шаблонах. Значит **нет никакого риска «сломать бандл»** при правке вёрстки, но и нет возможности легко добавить сложное поведение.

### 14. Печать КП: `.no-print` и отдельный `@media print`

Есть два независимых механизма печати:
- `style.css` → `@media print { .topnav, .footer, .actions, .no-print { display: none } }` — для страниц приложения.
- `quote-print.ejs` → собственный `@media print { .btn-print { display: none } body { padding: 0 } }`.

При редизайне важно не «убить» печать: в `quote-view.ejs` кнопка `.no-print` ведёт на `/print` — если объединять стили, `.no-print` должен сохраниться.

### 15. `.status` в `quotes.ejs` — единственный компонент, живущий вне системы

Перенос статус-бейджей в `style.css` (с токенами `--success`, `--warn`, `--danger`, `--muted`) — очевидный шаг консолидации, который заодно починит дефект из п. 3.

---

## Поток данных (для UI-контекста)

1. Браузер → `GET /calc` → `server.js` → middleware `res.locals.user` (запрос к таблице `users`) → `routes/calc.js` → `res.render('calc', { options, manufacturers, result, isAdmin, ... })`.
2. `views/calc.ejs` → `include('partials/header')` (получает `user` из `res.locals`) → генерирует `<link rel="stylesheet" href="/css/style.css">` → разметка формы.
3. При наличии `result` — тот же шаблон рендерит 6 блоков результатов (характеристики, свойства хладагента, компрессоры, трубопроводы, виброгасители через `partials/vibration-table`, спецификация, стоимость `card price-card`).
4. `isAdmin` управляет видимостью блока разбивки цены (материалы / мелочь 5% / работы 30% / профит 15%). **Клиент видит только итоговую цену** — это ключевая UI-инварианта: вся внутренняя калькуляция обёрнута в `<% if (isAdmin) %>`.
5. Кнопка «Сохранить как КП» → POST `/calc` → `routes/quotes.js` → редирект на `/quotes/:number`.
6. Печать: `quote-view.ejs` → ссылка `/quotes/:number/print` (`target="_blank"`) → `views/quote-print.ejs` (автономный документ).

---

## Приоритеты редизайна (карта работ, не реализация)

**Уровень 1 — консолидация (без риска):**
1. Перенести `.status*` из `<style>` в `quotes.ejs` в `public/css/style.css`; добавить отсутствующие `.status-pending`, `.status-active`. → чинит `/admin/users`.
2. Свести `quote-print.ejs` к фирменной палитре (`#0b5fa5` → `--brand` / `--brand-2`) или вынести его стили в отдельный `public/css/print.css` с теми же токенами.
3. Решить судьбу `'Inter'` (реально подключить или убрать из стека).

**Уровень 2 — систематизация:**
4. Добавить spacing- и typography-токены (`--space-*`, `--text-*`).
5. Добавить `btn-secondary` / `btn-ghost` и `:focus-visible` / `:disabled` состояния.
6. Добавить индикатор активного пункта меню (`res.locals.currentPath` + `.nav-links a.is-active`).
7. Заменить инлайн-стили (см. п. 10) на классы-утилиты.

**Уровень 3 — современные тренды:**
8. Тёмная тема через `@media (prefers-color-scheme: dark)` или `[data-theme]` — все цвета уже токенизированы, это большой плюс.
9. Иконки вместо эмодзи (инлайн-SVG-спрайт; `logo-mair-wordmark.svg` уже использует `currentColor` как образец подхода).
10. Мобильная адаптация: `.form-row` → `1fr` на `<560px`, `options-grid` → `minmax(0,1fr)`.
11. a11y: связать `label`/`input` через `for`/`id`, `role="status"` на `.alert`, `aria-hidden` на декоративных иконках, активный пункт меню через `aria-current="page"`.

**Чего делать нельзя (сломает функциональность):**
- Удалять `.no-print` / `@media print` — сломается печать КП.
- Удалять `#autoBlock` / `#manualBlock` и `id="calcForm"` — их использует инлайн-JS в `calc.ejs`.
- Менять `<%- include('partials/header', { title }) %>` на другой способ подключения — `title` используется в `<title>`.
- Удалять `res.locals.user`-зависимые условия `<% if (user) %>` в `header.ejs` — навигация перестанет отличать гостя от пользователя.
- Переименовывать классы, не проверив все 12 шаблонов (полный список использования — в таблице «Module Reference»).

---

## Module Reference (UI-слой)

| Файл | Назначение |
|---|---|
| `public/css/style.css` | ★ Единственный глобальный стиль: токены `:root`, шапка, карточки, формы, кнопки, таблицы, алерты, auth-card, скроллбар, `@media print` |
| `views/partials/header.ejs` | `<!DOCTYPE>` + `<head>` + `<link>` на CSS + sticky-навбар (`.topnav`) + открытие `<main class="container">` |
| `views/partials/footer.ejs` | Закрытие `</main>` + `<footer class="footer">` |
| `views/partials/vibration-table.ejs` | Таблица виброгасителей; наследует `.table`, `.hint`; колонка «Цена» — только для админа |
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

Для того, кто берётся за редизайн:

1. `public/css/style.css` — **начать здесь**: весь визуальный словарь в одном файле, включая фирменные токены `--brand: #173F6D` / `--brand-2: #2E6FB7`.
2. `views/partials/header.ejs` — понять единственную точку подключения CSS и что `header`/`footer` общие для всех страниц.
3. `views/calc.ejs` — самая большая и самая важная страница: 90% компонентов дизайн-системы встречаются именно тут.
4. `views/quote-print.ejs` — понять второй, автономный дизайн-слой и расхождение по синему `#0b5fa5`.
5. `views/quotes.ejs` — увидеть инлайновые статус-стили, которые нужно консолидировать.
6. `views/admin-users.ejs` — увидеть дефект неопределённых `.status-pending` / `.status-active`.

---

## Что дальше

Задача «переверстать сайт с учётом современных трендов и фирменных цветов» — это **изменение кода** (правка `public/css/style.css`, `views/partials/header.ejs`, `views/quote-print.ejs`, `views/quotes.ejs` и связанных шаблонов). В **Explore Mode** изменения не вносятся — доступны только чтение и документирование.

Чтобы реализовать редизайн, переключитесь в **Act Mode** селектором режима внизу чата. Этот отчёт (`project_info__3.md` + содержимое ниже) переносится в контекст Act Mode, так что начинать с нуля не придётся: палитра, инвентарь стилей, карта дефектов и приоритеты работ уже собраны.
