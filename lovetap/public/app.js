/**
 * LoveTap — Frontend Application
 * Vanilla JS, no framework. Handles onboarding, Socket.IO, push subscription, and heart animation.
 */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────
  let userId = localStorage.getItem('lovetap_userId');
  let displayName = localStorage.getItem('lovetap_displayName');
  let vapidPublicKey = null;
  let socket = null;
  let lastTapTime = 0;
  const TAP_COOLDOWN_MS = 1000;

  // ─── DOM Elements ────────────────────────────────────────────────────────
  const onboardingModal = document.getElementById('onboarding-modal');
  const appEl = document.getElementById('app');
  const nameInput = document.getElementById('display-name-input');
  const startBtn = document.getElementById('start-btn');
  const userBadge = document.getElementById('user-badge');
  const heartBtn = document.getElementById('heart-btn');
  const feedEl = document.getElementById('feed');
  const toastEl = document.getElementById('toast');

  // ─── Init ────────────────────────────────────────────────────────────────
  async function init() {
    // Fetch VAPID public key
    try {
      const res = await fetch('/api/vapid-key');
      const data = await res.json();
      vapidPublicKey = data.publicKey;
    } catch (err) {
      console.error('Failed to fetch VAPID key:', err);
      showToast('❌ Ошибка подключения к серверу');
      return;
    }

    if (userId && displayName) {
      showApp();
    } else {
      showOnboarding();
    }

    // Register service worker
    registerServiceWorker();
  }

  // ─── Onboarding ──────────────────────────────────────────────────────────
  function showOnboarding() {
    onboardingModal.classList.remove('hidden');
    appEl.classList.add('hidden');
    nameInput.focus();
  }

  startBtn.addEventListener('click', handleOnboardingSubmit);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleOnboardingSubmit();
  });

  async function handleOnboardingSubmit() {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.style.borderColor = '#ff2d55';
      nameInput.placeholder = 'Пожалуйста, введи имя!';
      return;
    }

    // Generate unique user ID
    userId = generateUUID();
    displayName = name;
    localStorage.setItem('lovetap_userId', userId);
    localStorage.setItem('lovetap_displayName', displayName);

    // Save user to backend
    try {
      await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, displayName }),
      });
    } catch (err) {
      console.error('Failed to save user:', err);
    }

    // Request push notification permission
    await requestPushPermission();

    showApp();
  }

  // ─── App ─────────────────────────────────────────────────────────────────
  function showApp() {
    onboardingModal.classList.add('hidden');
    appEl.classList.remove('hidden');
    userBadge.textContent = displayName;

    connectSocket();
    loadRecentTaps();
  }

  // ─── Heart Tap ───────────────────────────────────────────────────────────
  heartBtn.addEventListener('click', handleHeartTap);
  // Prevent double-tap zoom on mobile
  heartBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleHeartTap();
  });

  async function handleHeartTap() {
    const now = Date.now();
    if (now - lastTapTime < TAP_COOLDOWN_MS) {
      showToast('⏳ Подожди секунду!');
      return;
    }
    lastTapTime = now;

    // Optimistic local animation
    triggerHeartAnimation();

    // Send tap to server
    try {
      const res = await fetch('/api/tap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          showToast('⏳ Слишком быстро!');
        } else {
          showToast(data.error || '❌ Ошибка тапа');
        }
      }
    } catch (err) {
      console.error('Tap request failed:', err);
      showToast('❌ Нет соединения');
    }
  }

  function triggerHeartAnimation() {
    heartBtn.classList.remove('tapped');
    // Force reflow to restart animation
    void heartBtn.offsetWidth;
    heartBtn.classList.add('tapped');

    // Remove class after animation completes
    setTimeout(() => {
      heartBtn.classList.remove('tapped');
    }, 450);
  }

  // ─── Socket.IO ───────────────────────────────────────────────────────────
  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('🔌 Socket.IO connected');
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket.IO disconnected');
    });

    socket.on('heart-tap', (tap) => {
      // Animate heart for ALL users when anyone taps
      triggerHeartAnimation();

      // Add to feed (only if not our own tap to avoid duplicates since we already see it)
      addFeedItem(tap, true);
    });
  }

  // ─── Feed ────────────────────────────────────────────────────────────────
  async function loadRecentTaps() {
    try {
      const res = await fetch('/api/taps?limit=20');
      const data = await res.json();
      if (data.taps && data.taps.length > 0) {
        renderFeed(data.taps);
      }
    } catch (err) {
      console.error('Failed to load taps:', err);
    }
  }

  function renderFeed(taps) {
    feedEl.innerHTML = '';
    taps.forEach((tap) => addFeedItem(tap, false));
  }

  function addFeedItem(tap, isNew) {
    // Remove empty message if present
    const emptyMsg = feedEl.querySelector('.feed-empty');
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement('div');
    item.className = 'feed-item' + (isNew ? ' new' : '');
    item.innerHTML = `
      <span class="feed-item-emoji">💖</span>
      <div class="feed-item-info">
        <div class="feed-item-name">${escapeHtml(tap.displayName)}</div>
        <div class="feed-item-time">${formatTime(tap.createdAt)}</div>
      </div>
    `;

    feedEl.prepend(item);

    // Keep max 30 items
    while (feedEl.children.length > 30) {
      feedEl.removeChild(feedEl.lastChild);
    }
  }

  // ─── Push Notifications ──────────────────────────────────────────────────
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      console.log('✅ Service Worker registered:', registration.scope);
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  }

  async function requestPushPermission() {
    if (!('PushManager' in window)) {
      console.warn('Push API not supported');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('Push permission denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = subscription.toJSON();

      await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          displayName,
          subscription: subJson,
        }),
      });

      console.log('✅ Push subscription saved');
    } catch (err) {
      console.error('Push subscription failed:', err);
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 5) return 'только что';
    if (diffSec < 60) return `${diffSec} сек. назад`;
    if (diffMin < 60) return `${diffMin} мин. назад`;
    if (diffHour < 24) return `${diffHour} ч. назад`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let toastTimeout = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden', 'hiding');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.add('hiding');
      setTimeout(() => {
        toastEl.classList.add('hidden');
        toastEl.classList.remove('hiding');
      }, 300);
    }, 2500);
  }

  // ─── Start ───────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
