// Service Worker для P2P Social Network
const CACHE_NAME = 'p2p-social-v1';
const STATIC_CACHE = 'static-v1';
const DYNAMIC_CACHE = 'dynamic-v1';

// Файлы для кеширования
const STATIC_FILES = [
    './',
    './index.html',
    './styles.css',
    './security.js',
    './storage.js',
    './network.js',
    './app.js',
    './cities.json',
    'https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap'
];

// URLs, которые не нужно кешировать
const NETWORK_ONLY = [
    'wss://',
    'ws://',
    '/sockjs-node/',
    '/hot-update'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('SW: Installing...');
    
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then(cache => {
                console.log('SW: Caching static files');
                return cache.addAll(STATIC_FILES.filter(url => !url.startsWith('http')));
            }),
            caches.open(DYNAMIC_CACHE).then(cache => {
                console.log('SW: Dynamic cache ready');
                return cache;
            })
        ]).then(() => {
            console.log('SW: Installation complete');
            return self.skipWaiting();
        }).catch(error => {
            console.error('SW: Installation failed', error);
        })
    );
});

// Активация Service Worker
self.addEventListener('activate', event => {
    console.log('SW: Activating...');
    
    event.waitUntil(
        Promise.all([
            // Очистка старых кешей
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE && 
                            cacheName !== CACHE_NAME) {
                            console.log('SW: Deleting old cache', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Принятие контроля над всеми клиентами
            self.clients.claim()
        ]).then(() => {
            console.log('SW: Activation complete');
        }).catch(error => {
            console.error('SW: Activation failed', error);
        })
    );
});

// Обработка сетевых запросов
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Пропускаем WebSocket соединения
    if (isNetworkOnly(request.url)) {
        return;
    }
    
    // Стратегия кеширования в зависимости от типа ресурса
    if (isStaticAsset(request)) {
        event.respondWith(cacheFirst(request));
    } else if (isApiRequest(request)) {
        event.respondWith(networkFirst(request));
    } else if (isHTMLRequest(request)) {
        event.respondWith(staleWhileRevalidate(request));
    } else {
        event.respondWith(networkFirst(request));
    }
});

// Фоновая синхронизация
self.addEventListener('sync', event => {
    console.log('SW: Background sync triggered', event.tag);
    
    if (event.tag === 'sync-posts') {
        event.waitUntil(syncPosts());
    } else if (event.tag === 'cleanup-cache') {
        event.waitUntil(cleanupCache());
    }
});

// Push уведомления
self.addEventListener('push', event => {
    console.log('SW: Push received');
    
    const options = {
        body: event.data ? event.data.text() : '📝 Новая запись в сети!',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: Date.now().toString()
        },
        actions: [
            {
                action: 'open',
                title: '👁️',
                icon: '/icon-open.png'
            },
            {
                action: 'close',
                title: '❌',
                icon: '/icon-close.png'
            }
        ],
        requireInteraction: false,
        silent: false
    };

    event.waitUntil(
        self.registration.showNotification('P2P Social', options)
    );
});

// Клики по уведомлениям
self.addEventListener('notificationclick', event => {
    console.log('SW: Notification clicked', event.action);
    
    event.notification.close();

    if (event.action === 'open') {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clientList => {
                // Попытка найти открытое окно
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Открытие нового окна
                if (clients.openWindow) {
                    return clients.openWindow('./');
                }
            })
        );
    }
});

// Обработка сообщений от главного потока
self.addEventListener('message', event => {
    console.log('SW: Message received', event.data);
    
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            event.ports[0].postMessage({ version: CACHE_NAME });
            break;
            
        case 'UPDATE_CACHE':
            event.waitUntil(updateCache(data));
            break;
            
        case 'SYNC_REQUEST':
            event.waitUntil(
                self.registration.sync.register('sync-posts')
                    .catch(error => console.error('SW: Sync registration failed', error))
            );
            break;
            
        case 'CLEAR_CACHE':
            event.waitUntil(clearAllCaches());
            break;
    }
});

// Стратегии кеширования

// Cache First - для статических ресурсов
async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('SW: Cache first failed', error);
        return new Response('Offline', { status: 503 });
    }
}

// Network First - для динамических данных
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('SW: Network failed, trying cache');
        
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Fallback для HTML запросов
        if (request.destination === 'document') {
            const cache = await caches.open(STATIC_CACHE);
            return cache.match('./index.html');
        }
        
        return new Response('Offline', { 
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

// Stale While Revalidate - для HTML страниц
async function staleWhileRevalidate(request) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(error => {
        console.log('SW: Network update failed', error);
        return cachedResponse;
    });
    
    return cachedResponse || fetchPromise;
}

// Утилиты для определения типов запросов

function isNetworkOnly(url) {
    return NETWORK_ONLY.some(pattern => url.includes(pattern));
}

function isStaticAsset(request) {
    const url = new URL(request.url);
    return (
        request.method === 'GET' &&
        (url.pathname.endsWith('.css') ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.json') ||
         url.pathname.includes('fonts.googleapis.com') ||
         url.pathname.includes('fonts.gstatic.com'))
    );
}

function isApiRequest(request) {
    const url = new URL(request.url);
    return url.pathname.startsWith('/api/');
}

function isHTMLRequest(request) {
    return request.destination === 'document';
}

// Фоновые задачи

async function syncPosts() {
    try {
        console.log('SW: Syncing posts...');
        
        // Получение данных из IndexedDB
        const data = await getStoredData();
        
        // Уведомление главного потока о синхронизации
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETE',
                posts: data.posts || 0,
                timestamp: Date.now()
            });
        });
        
        console.log('SW: Sync completed');
        return true;
    } catch (error) {
        console.error('SW: Sync failed', error);
        throw error;
    }
}

async function cleanupCache() {
    try {
        console.log('SW: Cleaning up cache...');
        
        const cacheNames = await caches.keys();
        const dynamicCache = await caches.open(DYNAMIC_CACHE);
        const requests = await dynamicCache.keys();
        
        // Удаляем старые записи (старше 24 часов)
        const maxAge = 24 * 60 * 60 * 1000;
        const now = Date.now();
        
        for (const request of requests) {
            const response = await dynamicCache.match(request);
            const date = response.headers.get('date');
            
            if (date) {
                const responseDate = new Date(date).getTime();
                if (now - responseDate > maxAge) {
                    await dynamicCache.delete(request);
                }
            }
        }
        
        console.log('SW: Cache cleanup completed');
    } catch (error) {
        console.error('SW: Cache cleanup failed', error);
    }
}

async function updateCache(urls) {
    try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(urls);
        console.log('SW: Cache updated');
    } catch (error) {
        console.error('SW: Cache update failed', error);
    }
}

async function clearAllCaches() {
    try {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
        );
        console.log('SW: All caches cleared');
    } catch (error) {
        console.error('SW: Cache clearing failed', error);
    }
}

// Работа с данными

async function getStoredData() {
    // Простая имитация получения данных
    // В реальности здесь была бы работа с IndexedDB
    return {
        posts: Math.floor(Math.random() * 10),
        timestamp: Date.now()
    };
}

// Обработка ошибок
self.addEventListener('error', event => {
    console.error('SW: Global error', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('SW: Unhandled promise rejection', event.reason);
});

// Периодические задачи
function startPeriodicTasks() {
    // Очистка кеша каждые 6 часов
    setInterval(() => {
        self.registration.sync.register('cleanup-cache');
    }, 6 * 60 * 60 * 1000);
}

// Запуск периодических задач
startPeriodicTasks();

console.log('SW: Service Worker loaded and ready');
