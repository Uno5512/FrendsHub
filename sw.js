// Service Worker для P2P Social
const CACHE_NAME = 'p2p-social-v1';
const urlsToCache = [
    '/',
    '/index.html',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap',
    'https://fonts.gstatic.com/s/rubik/v23/iJWKBXyIfDnIV7nBrXyw023e.woff2'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('Service Worker: Установка');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Кеширование файлов');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Service Worker: Ошибка кеширования', error);
            })
    );
});

// Активация Service Worker
self.addEventListener('activate', event => {
    console.log('Service Worker: Активация');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Удаление старого кеша', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Обработка сетевых запросов
self.addEventListener('fetch', event => {
    // Пропускаем запросы к WebRTC signaling серверам
    if (event.request.url.includes('signaling') || 
        event.request.url.includes('stun') || 
        event.request.url.includes('turn')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Возвращаем кешированную версию или загружаем из сети
                if (response) {
                    return response;
                }

                return fetch(event.request).then(fetchResponse => {
                    // Проверяем валидность ответа
                    if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
                        return fetchResponse;
                    }

                    // Клонируем ответ для кеширования
                    const responseToCache = fetchResponse.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });

                    return fetchResponse;
                }).catch(() => {
                    // Если сеть недоступна, возвращаем офлайн страницу
                    if (event.request.destination === 'document') {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});

// Синхронизация в фоне
self.addEventListener('sync', event => {
    if (event.tag === 'sync-posts') {
        console.log('Service Worker: Фоновая синхронизация постов');
        event.waitUntil(syncPosts());
    }
});

// Обработка push уведомлений (для будущих версий)
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Новое сообщение в P2P Social!',
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'Открыть приложение',
                icon: '/icon-explore.png'
            },
            {
                action: 'close',
                title: 'Закрыть',
                icon: '/icon-close.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('P2P Social', options)
    );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Функция синхронизации постов
async function syncPosts() {
    try {
        // Получаем сохраненные посты из IndexedDB или localStorage
        const posts = await getStoredPosts();
        
        // Здесь можно реализовать логику отправки постов через WebRTC
        // когда приложение снова онлайн
        
        console.log('Service Worker: Синхронизировано', posts.length, 'постов');
        
        // Уведомляем основное приложение о синхронизации
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETE',
                posts: posts.length
            });
        });
        
    } catch (error) {
        console.error('Service Worker: Ошибка синхронизации', error);
    }
}

// Получение сохраненных постов
async function getStoredPosts() {
    return new Promise((resolve) => {
        // Имитация получения данных из IndexedDB
        // В реальном приложении здесь будет полноценная работа с IndexedDB
        const storedData = localStorage.getItem('p2p_crdt_state');
        if (storedData) {
            try {
                const parsedData = JSON.parse(storedData);
                resolve(parsedData.length || 0);
            } catch (error) {
                resolve(0);
            }
        } else {
            resolve(0);
        }
    });
}

// Обработка сообщений от основного приложения
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({version: CACHE_NAME});
    }
});

// Обновление кеша при обнаружении новой версии
self.addEventListener('message', event => {
    if (event.data.action === 'UPDATE_CACHE') {
        event.waitUntil(
            caches.open(CACHE_NAME).then(cache => {
                return cache.addAll(urlsToCache);
            })
        );
    }
});

console.log('Service Worker загружен и готов к работе');
