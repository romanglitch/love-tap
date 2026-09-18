# 💖 LoveTap

Real-time web-приложение для отправки любви одним нажатием. Когда любой пользователь нажимает на сердце — оно анимируется у **всех** подключённых пользователей в реальном времени, а подписанные пользователи получают push-уведомление.

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Real-time | Socket.IO |
| Push | Web Push API (VAPID) |
| Frontend | Vanilla HTML/CSS/JS (SPA) |
| Deploy | Docker + Docker Compose |

## 📁 Project Structure

```
lovetap/
├── prisma/
│   └── schema.prisma            # Database schema
├── src/
│   └── server.ts                # Express + Socket.IO + Web Push backend
├── public/
│   ├── index.html               # Main page (Russian UI)
│   ├── styles.css               # Mobile-first styles + heart animation
│   ├── app.js                   # Frontend logic
│   ├── sw.js                    # Service Worker for push notifications
│   ├── manifest.json            # PWA manifest
│   ├── icon-192.png             # App icon 192x192
│   ├── icon-512.png             # App icon 512x512
│   └── badge-72.png             # Notification badge
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # App + PostgreSQL orchestration
├── docker-entrypoint.sh         # Auto-migration on container start
├── .dockerignore
├── .env.example                 # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🚀 Deployment Guide (VPS Server)

Полная пошаговая инструкция: от создания сервера до работающего приложения.

### Step 1: Создание сервера

Создайте VPS на любом провайдере (Ubuntu 22.04 / 24.04 LTS рекомендуется):

- **Hetzner**, **DigitalOcean**, **Vultr**, **Timeweb**, **Selectel** и т.д.
- Минимальные требования: **1 CPU, 1 GB RAM, 20 GB SSD**
- Откройте порты **22** (SSH), **80** (HTTP), **443** (HTTPS) в фаерволе

Подключитесь по SSH:
```bash
ssh root@YOUR_SERVER_IP
```

### Step 2: Установка Docker и Docker Compose

```bash
# Обновление системы
apt update && apt upgrade -y

# Установка Docker (официальный скрипт)
curl -fsSL https://get.docker.com | sh

# Проверка установки
docker --version
docker compose version

# (Опционально) Добавить пользователя в группу docker
usermod -aG docker $USER
```

### Step 3: Установка Git

```bash
apt install -y git

# Проверка
git --version
```

### Step 4: Клонирование репозитория

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/lovetap.git
cd lovetap
```

### Step 5: Генерация VAPID ключей

```bash
# Установим Node.js временно для генерации ключей
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Генерация ключей
npx web-push generate-vapid-keys
```

Скопируйте `Public Key` и `Private Key` из вывода.

### Step 6: Настройка переменных окружения

```bash
cp .env.example .env
nano .env
```

Заполните файл:
```env
# Вставьте сгенерированные VAPID ключи
VAPID_PUBLIC_KEY="BNq-xxxxxxxxxxxx..."
VAPID_PRIVATE_KEY="abc123xxxxxxxxxxxx..."

# Пароль для PostgreSQL (придумайте надёжный!)
DB_PASSWORD=your_strong_password_here

# Порт приложения
PORT=3000
NODE_ENV=production
```

> ⚠️ **Важно:** Никогда не коммитьте `.env` в репозиторий! Он уже добавлен в `.gitignore`.

### Step 7: Запуск через Docker Compose

```bash
docker compose up -d --build
```

Что происходит при запуске:
1. Собирается образ приложения (multi-stage build: compile TS → production image)
2. Запускается контейнер PostgreSQL 16
3. `docker-entrypoint.sh` ждёт готовности БД
4. Автоматически применяются Prisma миграции (`prisma migrate deploy`)
5. Запускается Node.js сервер

### Step 8: Проверка

```bash
# Статус контейнеров
docker compose ps

# Логи приложения
docker compose logs -f app

# Логи базы данных
docker compose logs -f db
```

Приложение доступно по адресу: **http://YOUR_SERVER_IP:3000**

---

## 🔧 Управление (Docker)

### Перезапуск после обновления кода
```bash
cd /opt/lovetap
git pull origin main
docker compose up -d --build
```

### Остановка
```bash
docker compose down
```

### Остановка с удалением данных БД
```bash
docker compose down -v
```

### Просмотр логов
```bash
docker compose logs -f          # Все сервисы
docker compose logs -f app      # Только приложение
docker compose logs --tail=100  # Последние 100 строк
```

### Подключение к БД
```bash
docker compose exec db psql -U lovetap -d lovetap
```

### Ручное применение миграций
```bash
docker compose exec app npx prisma migrate deploy
```

---

## 🔒 HTTPS (Рекомендуется)

Web Push API требует HTTPS. Используйте **nginx + certbot** как reverse proxy:

```bash
apt install -y nginx certbot python3-certbot-nginx
```

Создайте конфиг `/etc/nginx/sites-available/lovetap`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/lovetap /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your-domain.com
```

---

## 💻 Local Development (без Docker)

Для локальной разработки без Docker см. секцию ниже.

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### Setup
```bash
npm install
npx web-push generate-vapid-keys   # Скопировать ключи в .env
cp .env.example .env               # Заполнить DATABASE_URL + VAPID ключи
createdb lovetap                   # Создать БД
npx prisma migrate dev --name init # Миграции
npm run dev                        # http://localhost:3000
```

---

## 🔑 Key Features

### Onboarding
- При первом визите запрашивается имя пользователя
- Генерируется уникальный UUID (сохраняется в localStorage)
- Запрашивается разрешение на push-уведомления
- Подписка сохраняется в PostgreSQL

### Heart Tap
- Нажатие на сердце запускает CSS-анимацию (scale + color pulse)
- Анимация воспроизводится у **всех** подключённых пользователей через Socket.IO
- Тап логируется в БД с user_id и timestamp
- Rate limiting: максимум 1 тап в секунду на пользователя

### Push Notifications
- Все подписанные пользователи (кроме отправителя) получают push-уведомление
- Сообщение: "💖 [Имя] отправил(а) вам любовь!"
- Недействительные подписки автоматически удаляются из БД
- Service Worker обрабатывает push events и показывает уведомления

### Live Feed
- Лента последних 20 тапов загружается при открытии
- Новые тапы добавляются в реальном времени через Socket.IO
- Отображается имя пользователя и относительное время

## 🗄 Database Schema

```prisma
model User {
  id            String             @id @default(uuid())
  displayName   String
  createdAt     DateTime           @default(now())
  subscriptions PushSubscription[]
  heartTaps     HeartTap[]
}

model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  user      User     @relation(...)
}

model HeartTap {
  id        String   @id @default(uuid())
  userId    String
  createdAt DateTime @default(now())
  user      User     @relation(...)
}
```

## 📝 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vapid-key` | Получить публичный VAPID ключ |
| POST | `/api/user` | Создать/обновить пользователя |
| POST | `/api/subscribe` | Сохранить push-подписку |
| GET | `/api/taps?limit=20` | Получить последние тапы |
| POST | `/api/tap` | Зарегистрировать тап сердца |

## ⚠️ Important Notes

- **HTTPS Required**: Web Push API и Service Workers требуют HTTPS (или localhost для разработки)
- **VAPID Keys**: Никогда не коммитьте приватный VAPID ключ в репозиторий
- **Rate Limiting**: Встроенный rate limiter предотвращает спам (1 тап/сек на пользователя)
- **Push Cleanup**: Подписки с ошибками 404/410 автоматически удаляются из БД
- **UI Language**: Весь интерфейс на русском языке
- **Docker Data**: PostgreSQL данные хранятся в Docker volume `pgdata` и сохраняются между перезапусками

## License

MIT
