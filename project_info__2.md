# Rack Calculation — Обзор кодовой базы

## Резюме

**Rack Calculation** — веб-приложение для подбора и расчёта холодильных агрегатов (компрессорно-ресиверных блоков, «rack»). Оно автоматически подбирает компрессоры по полиномам AHRI/EN12900, рассчитывает трубопроводы, подбирает виброгасители и прочие компоненты из каталога, формирует спецификацию (BOM), калькулирует коммерческую цену в EUR без НДС и оформляет коммерческое предложение (КП) с последующей производственной спецификацией.

Приложение реализовано как монолитный Express-сервер с серверным рендерингом (EJS), встроенной базой SQLite (модуль `node:sqlite`), ролевой моделью (`admin` / `client`) и опциональным Telegram-ботом для подтверждения регистраций клиентов. Пользователи — инженеры-проектировщики и менеджеры компании MAIR, а также администраторы, которые ведут каталог оборудования и цены.

Приложение не имеет фронтенд-сборки: JS на клиенте минимален и встроен прямо в шаблоны (например, AJAX-загрузка списка компрессоров в `views/calc.ejs`).

---

## Архитектура

### Primary architectural pattern
Классическая **слоистая серверная архитектура (MVC-подобная)** без разделения на отдельные сборки:

- **Presentation** — EJS-шаблоны (`views/`) + CSS (`public/css/style.css`) + инлайн-JS.
- **Routing / Controllers** — Express-роутеры (`routes/`), по одному на домен.
- **Services (Business logic / Domain)** — расчётные модули (`services/`), чистые функции + доступ к БД.
- **Data access** — прямой доступ через `db.prepare(...)` (модуль `db/database.js`), без ORM.
- **Integration** — Telegram-бот (`bot/telegram.js`).

### Технологический стек
| Слой | Технология |
|------|------------|
| Runtime | Node.js (использует встроенный `node:sqlite` — требуется Node 22+) |
| HTTP | `express` ^4.19 |
| Шаблоны | `ejs` ^3.1 |
| Сессии | `express-session` (in-memory store, cookie 7 дней) |
| Загрузка файлов | `express-fileupload` ^1.5 |
| БД | SQLite через `node:sqlite` `DatabaseSync`, режим WAL + `foreign_keys=ON` |
| Хэш паролей | `bcryptjs` |
| Excel | `xlsx` (SheetJS) — импорт каталога компрессоров |
| Бот | `telegraf` ^4.16 |
| Конфиг | `dotenv` |

### Запуск и жизненный цикл
Точка входа — `server.js`:

1. `require('dotenv').config()` — читает `.env` (PORT, SESSION_SECRET, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID).
2. `require('./db/database')` — при импорте модуль **сразу** открывает/создаёт БД, выполняет `initSchema()`, `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON` и **`syncOptions()`** (синхронизация справочника опций из `db/optionDefinitions.js`).
3. Настраивается Express: EJS, `views/`, `urlencoded`, `json`, `fileUpload`, `express.static(public)`.
4. Middleware явной установки `Content-Type: text/html; charset=utf-8` — только если заголовок ещё не задан, иначе статика ломалась бы (см. «Неочевидное»).
5. `express-session` + middleware, вычисляющий `res.locals.user` (загружает пользователя по `req.session.userId`, если статус `active`).
6. Монтируются роутеры: `/` (auth), `/calc` (auth), `/quotes` (auth), `/admin` (admin).
7. Запускается `app.listen(PORT)` и неблокирующий `startBot()`.

### Как всё связано (поток данных на уровне подсистем)
```
routes/calc.js  ──► services/calc.js (оркестратор runCalculation)
                        ├── services/selection.js    (полиномы AHRI, подбор КМ)
                        ├── services/piping.js       (трубопроводы)
                        ├── services/vibration.js    (виброгасители)
                        ├── services/options.js      (правила → BOM) ──► db/optionDefinitions.js
                        ├── services/pricing.js      (калькуляция, номер КП)
                        └── services/refrigerants.js (свойства хладагентов, точки цикла)
                                    │
        db/database.js (SQLite) ◄───┴── tables: compressors, components, pipe_sizes, options, ...
```

Ключевой архитектурный факт: **весь расчёт — это чистая функция `runCalculation(input, discountPercent)`**, возвращающая один большой JSON-объект (`cycle`, `selection`, `piping`, `vibration`, `options`, `bom`, `totals`, `warnings`). Именно этот JSON сериализуется и сохраняется в `quotes.result_json`, поэтому сохранённое КП — это «снимок» расчёта, а не пересчёт при каждом просмотре.

---

## Структура каталогов

```
Rack Calculation/
├── server.js                  — точка входа Express: конфиг, middleware, монтирование роутов
├── package.json               — зависимости и скрипты (start / seed / template)
├── .env.example               — шаблон конфигурации (PORT, SESSION_SECRET, Telegram)
│
├── db/
│   ├── database.js            — открытие SQLite, схема всех таблиц, syncOptions()
│   ├── optionDefinitions.js   — ОПРЕДЕЛЕНИЯ ОПЦИЙ (единый источник истины для справочника options)
│   └── seed.js                — наполнение демо-данными: хладагенты, КМ, компоненты, трубы, админ
│
├── services/                  — вся бизнес-логика (чистые функции + запросы к БД)
│   ├── refrigerants.js        — табличные свойства хладагентов, интерполяция, точки цикла
│   ├── selection.js           — вычисление полиномов AHRI, автоподбор и пересчёт характеристик
│   ├── piping.js              — расчёт диаметров линий по скорости
│   ├── vibration.js           — подбор виброгасителей на каждый компрессор (всас/нагнег)
│   ├── options.js             — правила автовключения опций + подбор артикулов из каталога
│   ├── pricing.js             — калькуляция цены и генерация номера КП
│   ├── calc.js                — ОРКЕСТРАТОР полного расчёта
│   └── polyfit.js             — генерация полиномов AHRI физической моделью (МНК)
│
├── routes/
│   ├── auth.js                — вход, регистрация, выход
│   ├── calc.js                — форма подбора + 2 внутренних API (варианты, список КМ)
│   ├── quotes.js              — сохранение КП, список, просмотр, печать, спецификация, CSV, статусы
│   └── admin.js               — пользователи, импорт Excel, каталог
│
├── bot/
│   └── telegram.js            — бот подтверждения регистраций (approve/reject)
│
├── views/                     — EJS-шаблоны
│   ├── partials/header.ejs / footer.ejs / vibration-table.ejs
│   ├── calc.ejs               — мастер подбора + результаты (главная рабочая страница)
│   ├── quotes.ejs / quote-view.ejs / quote-print.ejs / production.ejs
│   ├── login.ejs / register.ejs
│   ├── admin-users.ejs / admin-import.ejs / admin-catalog.ejs
│   └── error.ejs
│
├── public/css/style.css       — все стили приложения
├── public/assets/             — логотипы MAIR (SVG) и бренд-изображения
│
├── data/                      — SQLite-файл БД и рабочая область
│   ├── rack-calc.db (+ -wal, -shm)
│   └── import-template.xlsx   — шаблон Excel для импорта каталога
│
├── scripts/
│   ├── makeTemplate.js        — генератор data/import-template.xlsx
│   └── _tmp_*                 — одноразовые артефакты извлечения бренд-цветов из PDF
│
└── assets/лого MAIR.svg       — исходный логотип
```

> Примечание: каталог `scripts/_tmp_*` (включая `_tmp_img/` и `_tmp_out.txt`) — это **разовые вспомогательные артефакты** (разбор фирменного PDF MAIR для извлечения цветов и изображений), а не часть работающего приложения. Их можно игнорировать при изучении доменной логики.

---

## Ключевые абстракции

### `runCalculation(input, discountPercent)` — оркестратор расчёта
- **Файл**: `services/calc.js`
- **Ответственность**: единственная точка входа в бизнес-логику; выполняет полный конвейер и собирает итоговый объект.
- **Интерфейс**: принимает `input` (`refrigerant`, `tEvap`, `tCond`, `dTsh`, `dTsc`, `requiredKw`, `housingCode`, `mode`, `auto`, `manual`, `selectedOptions`) и скидку. Возвращает `{ input, cycle, selection, piping, vibration, options, bom, totals, warnings }`.
- **Порядок работы**: (1) выбор компрессоров → (2) пересчёт характеристик → (3) трубопроводы → (4) виброгасители → (5) опции→BOM → (6) корпус → (7) фиксированные позиции → (8) сборка BOM → (9) цены → (10) точки цикла.
- **Константа** `FIXED_ITEMS` — 5 жёстко зашитых позиций: «Голова отжима» (450), «Контроллер» (300), «Шкаф» (600), «Кондер» (1100), «Винты» (240) EUR. Это цены в коде, **не** в БД.
- **Валидация**: ошибка, если не задан хладагент, температуры, или `tCond <= tEvap`.
- **Используется в**: `routes/calc.js`, `routes/quotes.js`.

### `selection` — расчёт и подбор компрессоров
- **Файл**: `services/selection.js`
- **Ключевые функции**: `evalPoly` (10-членный полином AHRI), `compressorPerformance` (возвращает характеристики или **`null` вне диапазонов** `min/max_tevap`/`min/max_tcond`), `autoSelect` (перебор моделей × количества, фильтр `total >= requiredKw * 0.98`, отсечка превышения > 60 %, сортировка по минимальному превышению и цене), `evaluateSelection` (суммарные Q, N, ток, ṁ, COP).
- **Особенность**: при отсутствии полинома массового расхода ṁ оценивается как `Q_kW · 3600 / Δh₀`. Результаты полиномов делятся на `poly_multiplier`.

### `piping` — расчёт трубопроводов
- **Файл**: `services/piping.js`
- Рекомендуемые скорости: всас 12, нагнетание 12, жидкость 1.2 м/с; допустимые диапазоны 6–15 / 6–18 / 0.4–1.5.
- `calcLine`, `calcPiping`, `pipeArea`, `velocityAt`; учитывается `minSizeIn` (патрубок КМ). Возвращает и индивидуальные, и магистральные линии.

### `vibration` — подбор виброгасителей
- **Файл**: `services/vibration.js`
- Подбор **индивидуально на каждый компрессор**, раздельно для линий всасывания и нагнетания (3 КМ → 3 + 3).
- Размер: сначала по патрубку КМ (`port`), иначе по скорости (`speed`), иначе `unknown` + предупреждение.
- `planAll` агрегирует одинаковые артикулы в одну позицию BOM.

### `options` — правила автовключения и подбор компонентов
- **Файл**: `services/options.js`
- `ruleMatches` — проверка JSON-правил (`always`, `max_tevap`, `min_tevap`, `max_tcond`, `min_compressors`, `compressor_types`, `refrigerants`, `min_kw`, `max_kw`).
- `resolveOptions` ветвится по `sizing`: `per_compressor` (виброгасители), `pipe` / `pipe_per_compressor`, `capacity`, `none`.
- `ratedCapacity` — интерполяция мощности компонента между точками t=10 и t=−30; `kvrFactor` — поправка KVR по `tCond`.

### `refrigerants` — свойства хладагентов
- **Файл**: `services/refrigerants.js`
- R404a, R507a, R410a, R32, R449b; табличная сетка −50…+60 °C с линейной интерполяцией. Энтальпии — упрощённые линейные модели. `cyclePoints` возвращает 4 точки цикла.

### `pricing` — ценообразование
- **Файл**: `services/pricing.js`
- Факторы: мелочь 5 %, работы 30 %, профит 15 % — **от суммы материалов**, не каскадом. Скидка 0–100 %. `nextQuoteNumber` → `KP-{год}-{NNNN}`.

### `polyfit` — генерация полиномов физической моделью
- **Файл**: `services/polyfit.js` — МНК-подгонка 10 коэффициентов по физической модели объёмного компрессора (`Q0 = Vh/3600·ηv·ρвс·Δh0`). Используется только при seed'е для Bitzer/Copeland/Ridan/Invotech.

### `db` и `OPTIONS` — слой данных и единый источник истины
- **`db/database.js`** — единственное место определения схемы (`users`, `refrigerants`, `manufacturers`, `compressors`, `components`, `pipe_sizes`, `options`, `quotes`, `settings`) и `syncOptions()`.
- **`db/optionDefinitions.js`** — ~30 опций спецификации; `syncOptions()` UPSERT-ит их в БД и **удаляет** отсутствующие коды.

---

## Поток данных

### Поток 1: Подбор и расчёт
1. Форма `/calc` (`views/calc.ejs`): хладагент, `requiredKw`, `tEvap`, `tCond`, перегрев/переохлаждение, корпус, режим (`auto`/`manual`), опции.
2. Инлайн-JS при ручном режиме → `GET /calc/api/compressors` → `routes/calc.js` возвращает модели.
3. `POST /calc` → парсинг в `input` → **`runCalculation(input, user.discount_percent)`**.
4. `runCalculation`: `autoSelect`/ручной выбор → `evaluateSelection` → `calcPiping` → `planAll` (виброгасители) → `resolveOptions` (BOM) → сборка BOM + материалы → `computeTotals` → `cyclePoints`.
5. Рендер результата. Цены видны только админу.

### Поток 2: Сохранение и оформление КП
1. `POST /quotes/save` — **пересчёт** `runCalculation`, номер через `nextQuoteNumber`, сохранение `input_json` + `result_json`.
2. Просмотр `GET /quotes/:number` (права: клиент/админ), печать `/print`, статусы `/status` (клиент → только `sent`; `approved`/`rejected` — админ), производственная спецификация `/production` и `/production.csv` (CSV `;`, UTF-8 с BOM-префиксом).

### Поток 3: Регистрация и доступ
`POST /register` → `status='pending'` → `notifyNewRegistration` (Telegram-карточка approve/reject) → fallback `/admin/users` → `POST /login` проверяет статус и ставит `req.session.userId`.

### Поток 4: Импорт Excel
`POST /admin/import` → `XLSX.read` → парсинг по **фиксированным индексам колонок** китайской структуры → upsert в `compressors` (тип всегда `'scroll'`), строки без capacity-полинома пропускаются.

---

## Неочевидные поведения и проектные решения

- **Порядок middleware для charset критичен.** Установка `Content-Type: text/html; charset=utf-8` идёт **после** `express.static` и **только если заголовок не задан** — иначе CSS/JS отдавались бы как `text/html`.
- **Сессии in-memory** — при перезапуске все сессии теряются.
- **`res.locals.user` не переживает смену статуса** — отклонение активного пользователя мгновенно лишает его доступа.
- **Опции обновляются «на лету»** — `syncOptions()` при старте удаляет опции, которых нет в `OPTIONS`. Источник истины — код, а не БД.
- **КП хранит снимок**, но `POST /quotes/save` пересчитывает расчёт → сохранённое КП может отличаться от показанного на экране.
- **Скидка берётся из профиля**, а не из формы.
- **`runCalculation` бросает ошибки** явно (нет хладагента/температур, `tCond <= tEvap`, нет подходящих КМ, режим вне диапазона) — «тихого» неверного расчёта не бывает.
- **`db` — синхронный `DatabaseSync`**; WAL + `foreign_keys=ON` включены один раз.
- **`xlsx`-импорт завязан на фиксированные индексы колонок** (структура листов `Refcomp_polynom` / `Xecom_polynom`), неконфигурируем.
- **Единицы полиномов различаются**: Refcomp — кВт (`mult=1`), Xecom — Вт/кг-в-час (`mult=1000`). Ловушка при добавлении данных.
- **`telegraf` подключается лениво**, бот не критичен — без токена приложение работает.
- **Упрощённая физика**: энтальпии линейны по температуре, `ηv`/`COP` — модельные; README прямо отсылает к CoolProp/данным производителей для верификации.
- **Виброгасители: 3 КМ → 6 позиций** — размер по патрубку, иначе по скорости для индивидуальной производительности.
- **KVR подбирается с поправкой по tCond** (`kvrFactor` от 1.18 при −40 °C до 0.92 при +10 °C).
- **Таблица `settings` объявлена, но не используется** — задел на будущее.
- **Импорт Excel не заполняет `poly_current`/`poly_volume`**; цена по умолчанию из формы (1000 EUR).
- **CSV-экспорт добавляет BOM-префикс `\uFEFF`** для корректной кириллицы в Excel.

---

## Справочник модулей

| Файл | Назначение |
|------|------------|
| `server.js` | Точка входа: конфиг Express, middleware, монтирование роутов, старт сервера и бота |
| `db/database.js` | Открытие SQLite, схема всех таблиц, `syncOptions()` |
| `db/optionDefinitions.js` | Единый источник истины для ~30 опций спецификации |
| `db/seed.js` | Наполнение БД: хладагенты, производители, полиномы Refcomp/Xecom, генерируемые модели, компоненты, трубы, админ |
| `services/calc.js` | Оркестратор `runCalculation` |
| `services/selection.js` | Полиномы AHRI, `compressorPerformance`, `autoSelect`, `evaluateSelection` |
| `services/refrigerants.js` | Свойства хладагентов, `cyclePoints`, `dischargeTemp` |
| `services/piping.js` | Подбор диаметров линий по скорости |
| `services/vibration.js` | Подбор виброгасителей на каждый КМ (всас/нагнег) |
| `services/options.js` | `ruleMatches`, `resolveOptions`, `pickComponent`, `kvrFactor`, `ratedCapacity` |
| `services/pricing.js` | `computeTotals`, `nextQuoteNumber` |
| `services/polyfit.js` | МНК-генерация полиномов AHRI из физической модели |
| `routes/auth.js` | Вход / регистрация (pending) / выход |
| `routes/calc.js` | Форма подбора, POST-расчёт, API вариантов и списка компрессоров |
| `routes/quotes.js` | Сохранение/список/просмотр/печать КП, спецификация, CSV, статусы |
| `routes/admin.js` | Пользователи, импорт Excel, просмотр каталога |
| `bot/telegram.js` | `startBot`, `notifyNewRegistration`, approve/reject |
| `views/calc.ejs` | Главная страница: форма ввода + результаты + сохранение в КП |
| `views/quote-view.ejs` | Просмотр КП со статусами и действиями |
| `views/quote-print.ejs` | Печатная форма КП |
| `views/production.ejs` | Производственная спецификация |
| `views/partials/vibration-table.ejs` | Переиспользуемая таблица виброгасителей |
| `views/admin-users.ejs` / `admin-import.ejs` / `admin-catalog.ejs` | Админ-интерфейсы |
| `public/css/style.css` | Все стили приложения |
| `scripts/makeTemplate.js` | Генерация `data/import-template.xlsx` |

---

## Рекомендуемый порядок чтения

1. **`README.md`** — бизнес-контекст, стек, логика цены, допущения.
2. **`server.js`** — как собирается приложение: middleware, права, роуты, старт БД и бота.
3. **`db/database.js` + `db/optionDefinitions.js`** — модель данных и механизм `syncOptions()` (единый источник истины опций).
4. **`services/calc.js`** — оглавление всего расчёта.
5. **`services/selection.js` + `services/vibration.js`** — самая предметная и неочевидная холодильная логика.
6. **`routes/calc.js` + `views/calc.ejs`** — сквозной путь от формы до результата.
7. **`routes/quotes.js`** — как расчёт превращается в КП, спецификацию и CSV.

---

📄 Полный отчёт сохранён в файл **`project_info__1.md`** в корне проекта. Готов углубиться в любой из модулей по запросу.