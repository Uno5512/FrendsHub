// IndexedDB Storage Manager
class StorageManager {
    constructor() {
        this.dbName = 'SocialDB';
        this.dbVersion = 1;
        this.db = null;
        this.maxStorageSize = 50 * 1024 * 1024; // 50MB limit
        this.compressionThreshold = 1024; // Compress data larger than 1KB
        
        this.init();
    }

    async init() {
        try {
            this.db = await this.openDatabase();
            console.log('IndexedDB initialized');
        } catch (error) {
            console.error('IndexedDB initialization failed:', error);
            this.fallbackToLocalStorage();
        }
    }

    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Posts store
                if (!db.objectStoreNames.contains('posts')) {
                    const postsStore = db.createObjectStore('posts', { keyPath: 'id' });
                    postsStore.createIndex('author', 'author', { unique: false });
                    postsStore.createIndex('timestamp', 'timestamp', { unique: false });
                    postsStore.createIndex('type', 'type', { unique: false });
                    postsStore.createIndex('city', 'city', { unique: false });
                    postsStore.createIndex('expiresAt', 'expiresAt', { unique: false });
                }

                // User actions store
                if (!db.objectStoreNames.contains('userActions')) {
                    db.createObjectStore('userActions', { keyPath: 'postId' });
                }

                // Network state store
                if (!db.objectStoreNames.contains('networkState')) {
                    db.createObjectStore('networkState', { keyPath: 'key' });
                }

                // Cache store
                if (!db.objectStoreNames.contains('cache')) {
                    const cacheStore = db.createObjectStore('cache', { keyPath: 'key' });
                    cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    fallbackToLocalStorage() {
        console.warn('Falling back to localStorage');
        this.db = null;
    }

    // Generic database operations
    async performTransaction(storeName, mode, operation) {
        if (!this.db) {
            return this.localStorageOperation(storeName, operation);
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);

            operation(store, resolve, reject);
        });
    }

    // Posts operations
    async savePosts(posts) {
        const postsArray = Array.isArray(posts) ? posts : Array.from(posts.values());
        
        return this.performTransaction('posts', 'readwrite', (store, resolve, reject) => {
            let completed = 0;
            const total = postsArray.length;

            if (total === 0) {
                resolve();
                return;
            }

            postsArray.forEach(post => {
                const compressedPost = this.compressData(post);
                const request = store.put(compressedPost);
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) resolve();
                };
                
                request.onerror = () => reject(request.error);
            });
        });
    }

    async loadPosts() {
        if (!this.db) {
            return this.loadPostsFromLocalStorage();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['posts'], 'readonly');
            const store = transaction.objectStore('posts');
            const request = store.getAll();

            request.onsuccess = () => {
                const posts = request.result.map(post => this.decompressData(post));
                const postsMap = new Map(posts.map(post => [post.id, post]));
                resolve(postsMap);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async savePost(post) {
        const compressedPost = this.compressData(post);
        
        return this.performTransaction('posts', 'readwrite', (store, resolve, reject) => {
            const request = store.put(compressedPost);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deletePost(postId) {
        return this.performTransaction('posts', 'readwrite', (store, resolve, reject) => {
            const request = store.delete(postId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // User actions operations
    async saveUserActions(userActions) {
        const actionsArray = Array.from(userActions.entries()).map(([postId, actions]) => ({
            postId,
            ...actions
        }));

        return this.performTransaction('userActions', 'readwrite', (store, resolve, reject) => {
            let completed = 0;
            const total = actionsArray.length;

            if (total === 0) {
                resolve();
                return;
            }

            actionsArray.forEach(action => {
                const request = store.put(action);
                
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) resolve();
                };
                
                request.onerror = () => reject(request.error);
            });
        });
    }

    async loadUserActions() {
        if (!this.db) {
            return this.loadUserActionsFromLocalStorage();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['userActions'], 'readonly');
            const store = transaction.objectStore('userActions');
            const request = store.getAll();

            request.onsuccess = () => {
                const actionsMap = new Map();
                request.result.forEach(action => {
                    const { postId, ...rest } = action;
                    actionsMap.set(postId, rest);
                });
                resolve(actionsMap);
            };

            request.onerror = () => reject(request.error);
        });
    }

    // Network state operations
    async saveNetworkState(key, data) {
        const stateData = {
            key,
            data: this.compressData(data),
            timestamp: Date.now()
        };

        return this.performTransaction('networkState', 'readwrite', (store, resolve, reject) => {
            const request = store.put(stateData);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadNetworkState(key) {
        if (!this.db) {
            const stored = localStorage.getItem(`network_${key}`);
            return stored ? this.decompressData(JSON.parse(stored)) : null;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['networkState'], 'readonly');
            const store = transaction.objectStore('networkState');
            const request = store.get(key);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(this.decompressData(request.result.data));
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    // Cache operations
    async setCache(key, data, ttl = 3600000) { // 1 hour default TTL
        const cacheData = {
            key,
            data: this.compressData(data),
            timestamp: Date.now(),
            expiresAt: Date.now() + ttl
        };

        return this.performTransaction('cache', 'readwrite', (store, resolve, reject) => {
            const request = store.put(cacheData);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getCache(key) {
        if (!this.db) {
            const stored = localStorage.getItem(`cache_${key}`);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.expiresAt > Date.now()) {
                    return this.decompressData(parsed.data);
                } else {
                    localStorage.removeItem(`cache_${key}`);
                }
            }
            return null;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cache'], 'readonly');
            const store = transaction.objectStore('cache');
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                if (result && result.expiresAt > Date.now()) {
                    resolve(this.decompressData(result.data));
                } else if (result) {
                    // Expired, delete it
                    this.deleteCache(key);
                    resolve(null);
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async deleteCache(key) {
        return this.performTransaction('cache', 'readwrite', (store, resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Cleanup operations
    async cleanupExpiredPosts() {
        const now = Date.now();
        
        if (!this.db) {
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['posts'], 'readwrite');
            const store = transaction.objectStore('posts');
            const index = store.index('expiresAt');
            const request = index.openCursor(IDBKeyRange.upperBound(now));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async cleanupExpiredCache() {
        const now = Date.now();
        
        if (!this.db) {
            return;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');
            const index = store.index('timestamp');
            const request = index.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    if (cursor.value.expiresAt < now) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    // Compression utilities
    compressData(data) {
        const jsonString = JSON.stringify(data);
        
        if (jsonString.length < this.compressionThreshold) {
            return { ...data, _compressed: false };
        }

        try {
            // Simple compression using LZ-string like algorithm
            const compressed = this.simpleCompress(jsonString);
            return {
                _compressed: true,
                _data: compressed
            };
        } catch (error) {
            console.warn('Compression failed, storing uncompressed:', error);
            return { ...data, _compressed: false };
        }
    }

    decompressData(data) {
        if (!data._compressed) {
            const { _compressed, ...rest } = data;
            return rest;
        }

        try {
            const decompressed = this.simpleDecompress(data._data);
            return JSON.parse(decompressed);
        } catch (error) {
            console.error('Decompression failed:', error);
            return null;
        }
    }

    simpleCompress(str) {
        // Simple run-length encoding for demonstration
        // In production, use a proper compression library
        return btoa(encodeURIComponent(str));
    }

    simpleDecompress(compressed) {
        return decodeURIComponent(atob(compressed));
    }

    // LocalStorage fallback operations
    localStorageOperation(storeName, operation) {
        try {
            const key = `db_${storeName}`;
            const stored = localStorage.getItem(key);
            const data = stored ? JSON.parse(stored) : [];
            
            const result = operation(data);
            
            localStorage.setItem(key, JSON.stringify(data));
            return Promise.resolve(result);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    loadPostsFromLocalStorage() {
        try {
            const stored = localStorage.getItem('db_posts');
            if (stored) {
                const posts = JSON.parse(stored);
                return new Map(posts.map(post => [post.id, this.decompressData(post)]));
            }
            return new Map();
        } catch (error) {
            console.error('Failed to load posts from localStorage:', error);
            return new Map();
        }
    }

    loadUserActionsFromLocalStorage() {
        try {
            const stored = localStorage.getItem('db_userActions');
            if (stored) {
                const actions = JSON.parse(stored);
                return new Map(actions.map(action => {
                    const { postId, ...rest } = action;
                    return [postId, rest];
                }));
            }
            return new Map();
        } catch (error) {
            console.error('Failed to load user actions from localStorage:', error);
            return new Map();
        }
    }

    // Storage stats
    async getStorageStats() {
        if (!this.db) {
            return {
                used: this.getLocalStorageSize(),
                available: 5 * 1024 * 1024, // 5MB typical localStorage limit
                percentage: 0
            };
        }

        try {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                available: estimate.quota || this.maxStorageSize,
                percentage: estimate.usage && estimate.quota ? 
                    Math.round((estimate.usage / estimate.quota) * 100) : 0
            };
        } catch (error) {
            console.error('Failed to get storage estimate:', error);
            return { used: 0, available: this.maxStorageSize, percentage: 0 };
        }
    }

    getLocalStorageSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += localStorage[key].length + key.length;
            }
        }
        return total;
    }

    // Periodic cleanup
    startPeriodicCleanup() {
        setInterval(async () => {
            try {
                await this.cleanupExpiredPosts();
                await this.cleanupExpiredCache();
                console.log('Periodic cleanup completed');
            } catch (error) {
                console.error('Periodic cleanup failed:', error);
            }
        }, 30 * 60 * 1000); // Every 30 minutes
    }
}

// Initialize storage manager
window.storage = new StorageManager();
