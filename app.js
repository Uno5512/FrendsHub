// Main Application Logic
class SocialApp {
    constructor() {
        this.categories = ['все', 'event', 'meet', 'help', 'sale', 'other'];
        this.activeCategory = 'все';
        this.userActions = new Map();
        this.cities = [];
        
        this.init();
    }

    async init() {
        try {
            // Load cities data
            await this.loadCities();
            
            // Load user actions from storage
            await this.loadUserActions();
            
            // Initialize UI
            this.initCategories();
            this.populateCitySelects();
            this.setupEventListeners();
            
            // Initial render
            this.renderPosts();
            
            console.log('App initialized');
        } catch (error) {
            console.error('App initialization failed:', error);
        }
    }

    async loadCities() {
        try {
            const response = await fetch('./cities.json');
            const data = await response.json();
            this.cities = data.cities;
        } catch (error) {
            console.error('Failed to load cities:', error);
            // Fallback cities
            this.cities = [
                { code: 'moscow', name: 'Москва', emoji: '🏛️' },
                { code: 'spb', name: 'СПб', emoji: '🏰' },
                { code: 'other', name: 'Другой', emoji: '📍' }
            ];
        }
    }

    async loadUserActions() {
        try {
            this.userActions = await window.storage.loadUserActions();
        } catch (error) {
            console.error('Failed to load user actions:', error);
            this.userActions = new Map();
        }
    }

    async saveUserActions() {
        try {
            await window.storage.saveUserActions(this.userActions);
        } catch (error) {
            console.error('Failed to save user actions:', error);
        }
    }

    initCategories() {
        const container = document.getElementById('categories');
        if (!container) return;

        container.innerHTML = this.categories.map(cat => {
            const emoji = this.getCategoryEmoji(cat);
            return `
                <button class="category-btn ${cat === this.activeCategory ? 'active' : ''}" data-category="${cat}">
                    ${emoji}
                </button>
            `;
        }).join('');
    }

    getCategoryEmoji(category) {
        const emojis = {
            'все': '🌐',
            'event': '🎉',
            'meet': '🤝',
            'help': '🆘',
            'sale': '💰',
            'other': '📋'
        };
        return emojis[category] || '📋';
    }

    populateCitySelects() {
        const selects = ['postCity', 'filterCity'];
        
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select) return;

            // Keep the first option (placeholder)
            const firstOption = select.children[0];
            select.innerHTML = '';
            select.appendChild(firstOption);

            // Add city options
            this.cities.forEach(city => {
                const option = document.createElement('option');
                option.value = city.code;
                option.textContent = `${city.emoji} ${city.name}`;
                select.appendChild(option);
            });
        });
    }

    setupEventListeners() {
        // Category selection
        const categoriesContainer = document.getElementById('categories');
        if (categoriesContainer) {
            categoriesContainer.addEventListener('click', (e) => {
                const target = e.target.closest('[data-category]');
                if (target) {
                    this.activeCategory = target.getAttribute('data-category');
                    this.initCategories();
                    this.renderPosts();
                }
            });
        }

        // Create post button
        const createBtn = document.getElementById('createPostBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.showCreateForm());
        }

        // Close modal
        const closeModalBtn = document.getElementById('closeContactModal');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => this.hideContactModal());
        }

        // Modal background click
        const contactModal = document.getElementById('contactModal');
        if (contactModal) {
            contactModal.addEventListener('click', (e) => {
                if (e.target.id === 'contactModal') {
                    this.hideContactModal();
                }
            });
        }

        // Form clicks outside
        document.addEventListener('click', (e) => {
            const createForm = document.getElementById('createForm');
            const createBtn = document.getElementById('createPostBtn');
            
            if (createForm && !createForm.classList.contains('hidden') && 
                !createForm.contains(e.target) && 
                !createBtn.contains(e.target)) {
                this.hideCreateForm();
            }

            // Close report menus
            if (!e.target.closest('.report-menu')) {
                document.querySelectorAll('.report-dropdown').forEach(dropdown => {
                    dropdown.classList.add('hidden');
                });
            }
        });

        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContactModal();
                this.hideCreateForm();
            }
        });
    }

    showCreateForm() {
        const form = document.getElementById('createForm');
        const btn = document.getElementById('createPostBtn');
        
        if (form) {
            form.classList.remove('hidden');
            form.classList.add('glass');
        }
        if (btn) {
            btn.style.display = 'none';
        }
    }

    hideCreateForm() {
        const form = document.getElementById('createForm');
        const btn = document.getElementById('createPostBtn');
        
        if (form) {
            form.classList.add('hidden');
        }
        if (btn) {
            btn.style.display = 'flex';
        }
    }

    async createPost() {
        if (!window.checkRate('createPost')) {
            alert('⏰');
            return;
        }

        const title = document.getElementById('postTitle').value.trim();
        const description = document.getElementById('postDescription').value.trim();
        
        if (!title || !description) {
            alert('📝');
            return;
        }

        const postData = {
            title: window.sanitize(title),
            description: window.sanitize(description),
            tags: document.getElementById('postTags').value
                .split(',')
                .map(t => window.sanitize(t.trim()))
                .filter(t => t),
            contacts: window.sanitize(document.getElementById('postContacts').value.trim()),
            city: document.getElementById('postCity').value,
            type: this.activeCategory === 'все' ? 'event' : this.activeCategory,
            gender: document.getElementById('postGender').value,
            age: document.getElementById('postAge').value
        };

        if (!window.security.validatePostData(postData)) {
            alert('❌');
            return;
        }

        try {
            await this.createPostInNetwork(postData);
            
            // Clear form
            this.clearCreateForm();
            this.hideCreateForm();
            this.renderPosts();
            
        } catch (error) {
            console.error('Failed to create post:', error);
            alert('❌');
        }
    }

    async createPostInNetwork(postData) {
        const post = {
            id: this.generateId(),
            author: window.network.myId,
            timestamp: Date.now(),
            expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
            ...postData,
            likes: 0,
            likedBy: [],
            reports: { illegal: 0, provocation: 0, advertisement: 0 }
        };

        post.signature = await this.signPost(post);
        
        window.network.crdt.update(post.id, post);
        await window.network.saveState();
        
        window.network.broadcast({
            type: 'post',
            data: post
        });
        
        return post;
    }

    async signPost(post) {
        try {
            const data = JSON.stringify({
                author: post.author,
                title: post.title,
                description: post.description,
                timestamp: post.timestamp
            });
            
            return await window.security.generateHash(data);
        } catch (error) {
            console.error('Post signing failed:', error);
            return 'unsigned';
        }
    }

    generateId() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    clearCreateForm() {
        document.getElementById('postTitle').value = '';
        document.getElementById('postDescription').value = '';
        document.getElementById('postTags').value = '';
        document.getElementById('postContacts').value = '';
        document.getElementById('postCity').value = '';
        document.getElementById('postGender').value = '';
        document.getElementById('postAge').value = '';
        document.getElementById('postType').value = 'event';
    }

    cancelCreate() {
        this.hideCreateForm();
    }

    renderPosts() {
        const container = document.getElementById('postsFeed');
        if (!container) return;

        let posts = this.getFilteredPosts();
        
        if (posts.length === 0) {
            container.innerHTML = `
                <div class="glass empty-state">
                    <div class="empty-icon">🚀</div>
                </div>
            `;
            return;
        }

        container.innerHTML = posts.map(post => this.renderPost(post)).join('');
    }

    renderPost(post) {
        const userActions = this.getUserActions(post.id);
        const isMyPost = post.author === window.network.myId;
        const timeLeft = Math.max(0, post.expiresAt - Date.now());
        const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));
        
        return `
            <div class="glass post">
                ${post.flagged ? `
                    <div class="post-warning">
                        ⚠️ ${this.getReportTypeName(post.flagged)}
                    </div>
                ` : ''}
                
                <div class="post-header">
                    <div class="post-meta">
                        ${isMyPost ? '👤' : '👥'} • 
                        ${new Date(post.timestamp).toLocaleDateString()} • 
                        ⏱️ ${daysLeft}д
                        ${post.city ? ` • ${this.getCityName(post.city)}` : ''}
                        ${post.type ? ` • ${this.getCategoryEmoji(post.type)}` : ''}
                        ${post.gender ? ` • ${this.getGenderEmoji(post.gender)}` : ''}
                        ${post.age ? ` • ${post.age}` : ''}
                    </div>
                </div>
                
                <h3 class="post-title">${this.escapeHtml(post.title)}</h3>
                <p class="post-description">${this.escapeHtml(post.description)}</p>
                
                <div class="post-content">
                    ${post.tags && post.tags.length > 0 ? `
                        <div class="post-tags">
                            ${post.tags.map(tag => `
                                <span class="tag">#${this.escapeHtml(tag)}</span>
                            `).join('')}
                        </div>
                    ` : '<div></div>'}
                    
                    <div class="post-actions">
                        <button onclick="app.likePost('${post.id}')" 
                                class="post-btn ${userActions.liked ? 'liked' : ''}">
                            ${userActions.liked ? '❤️' : '🤍'} ${post.likes || 0}
                        </button>
                        
                        <button onclick="app.favoritePost('${post.id}')" 
                                class="post-btn ${userActions.favorite ? 'favorited' : ''}">
                            ${userActions.favorite ? '⭐' : '☆'}
                        </button>
                        
                        <button onclick="app.hidePost('${post.id}')" class="post-btn">
                            ${userActions.hidden ? '👁️' : '🙈'}
                        </button>

                        ${post.contacts ? `
                            <button onclick="app.showContacts('${post.id}')" class="post-btn contacts">
                                📞
                            </button>
                        ` : ''}
                        
                        ${!isMyPost ? `
                            <div class="report-menu">
                                <button onclick="app.toggleReportMenu('${post.id}')" class="post-btn report">
                                    <svg width="16" height="16" viewBox="0 0 400 400" fill="none">
                                        <path d="M151.753 123.032C169.29 100.11 202.191 91.1034 229.394 94.9823C262.055 99.6471 293.584 131.236 301.141 167.913C343.948 375.598 14.3513 329.118 112.438 149.962" stroke="#412623" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
                                        <path d="M297.601 94.1099C235.716 164.124 178.571 238.859 112.609 305" stroke="#412623" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                                <div class="report-dropdown hidden" id="reportMenu_${post.id}">
                                    <button onclick="app.reportPost('${post.id}', 'illegal')">🚫</button>
                                    <button onclick="app.reportPost('${post.id}', 'provocation')">⚡</button>
                                    <button onclick="app.reportPost('${post.id}', 'advertisement')">📢</button>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    getFilteredPosts() {
        let posts = window.network.getAllPosts();
        const search = document.getElementById('searchBox').value.toLowerCase();
        const cityFilter = document.getElementById('filterCity').value;
        const genderFilter = document.getElementById('filterGender').value;
        const ageFilter = document.getElementById('filterAge').value;
        const sortFilter = document.getElementById('filterSort').value;

        // Category filter
        if (this.activeCategory !== 'все') {
            posts = posts.filter(post => post.type === this.activeCategory);
        }

        // Search filter
        if (search) {
            posts = posts.filter(post => 
                post.title.toLowerCase().includes(search) ||
                post.description.toLowerCase().includes(search) ||
                (post.tags && post.tags.some(tag => tag.toLowerCase().includes(search)))
            );
        }

        // Other filters
        if (cityFilter) {
            posts = posts.filter(post => post.city === cityFilter);
        }

        if (genderFilter) {
            posts = posts.filter(post => post.gender === genderFilter);
        }

        if (ageFilter) {
            posts = posts.filter(post => post.age === ageFilter);
        }

        // Sort and special filters
        switch (sortFilter) {
            case 'my':
                posts = posts.filter(post => post.author === window.network.myId);
                break;
            case 'favorites':
                posts = posts.filter(post => this.getUserActions(post.id).favorite);
                break;
            case 'hidden':
                posts = posts.filter(post => this.getUserActions(post.id).hidden);
                break;
            case 'liked':
                posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                break;
            case 'old':
                posts.sort((a, b) => a.timestamp - b.timestamp);
                break;
            default: // 'new'
                posts.sort((a, b) => b.timestamp - a.timestamp);
        }

        return posts;
    }

    filterPosts() {
        this.renderPosts();
    }

    resetFilters() {
        document.getElementById('searchBox').value = '';
        document.getElementById('filterCity').value = '';
        document.getElementById('filterGender').value = '';
        document.getElementById('filterAge').value = '';
        document.getElementById('filterSort').value = 'new';
        this.renderPosts();
    }

    likePost(postId) {
        if (!window.checkRate('likePost')) {
            return;
        }

        const post = window.network.crdt.get(postId);
        if (!post) return;

        const userActions = this.getUserActions(postId);
        const action = userActions.liked ? 'unlike' : 'like';
        
        if (action === 'like') {
            post.likes = (post.likes || 0) + 1;
            post.likedBy = post.likedBy || [];
            if (!post.likedBy.includes(window.network.myId)) {
                post.likedBy.push(window.network.myId);
            }
            userActions.liked = true;
        } else {
            post.likes = Math.max(0, (post.likes || 0) - 1);
            post.likedBy = (post.likedBy || []).filter(id => id !== window.network.myId);
            userActions.liked = false;
        }

        window.network.crdt.update(postId, post);
        this.saveUserAction(postId, userActions);
        window.network.saveState();

        window.network.broadcast({
            type: 'like',
            data: {
                postId,
                userId: window.network.myId,
                action
            }
        });

        this.renderPosts();
    }

    hidePost(postId) {
        const userActions = this.getUserActions(postId);
        userActions.hidden = !userActions.hidden;
        this.saveUserAction(postId, userActions);
        this.renderPosts();
    }

    favoritePost(postId) {
        const userActions = this.getUserActions(postId);
        userActions.favorite = !userActions.favorite;
        this.saveUserAction(postId, userActions);
        this.renderPosts();
    }

    reportPost(postId, type) {
        if (!window.checkRate('reportPost')) {
            return;
        }

        const post = window.network.crdt.get(postId);
        if (!post) return;

        post.reports = post.reports || { illegal: 0, provocation: 0, advertisement: 0 };
        post.reports[type] = (post.reports[type] || 0) + 1;
        
        if (post.reports[type] >= 10) {
            post.flagged = type;
        }

        window.network.crdt.update(postId, post);
        window.network.saveState();
        
        window.network.broadcast({
            type: 'report',
            data: {
                postId,
                reportType: type,
                userId: window.network.myId
            }
        });

        document.getElementById(`reportMenu_${postId}`).classList.add('hidden');
        this.renderPosts();
    }

    toggleReportMenu(postId) {
        const menu = document.getElementById(`reportMenu_${postId}`);
        menu.classList.toggle('hidden');
        
        document.querySelectorAll('.report-dropdown').forEach(dropdown => {
            if (dropdown.id !== `reportMenu_${postId}`) {
                dropdown.classList.add('hidden');
            }
        });
    }

    showContacts(postId) {
        const post = window.network.crdt.get(postId);
        if (post && post.contacts) {
            const modal = document.getElementById('contactModal');
            const content = document.getElementById('contactContent');
            
            if (content) {
                content.innerHTML = post.contacts
                    .split('\n')
                    .map(line => `<p>${this.escapeHtml(line)}</p>`)
                    .join('');
            }
            
            if (modal) {
                modal.classList.remove('hidden');
            }
        }
    }

    hideContactModal() {
        const modal = document.getElementById('contactModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    getUserActions(postId) {
        if (!this.userActions.has(postId)) {
            this.userActions.set(postId, {
                liked: false,
                hidden: false,
                favorite: false
            });
        }
        return this.userActions.get(postId);
    }

    saveUserAction(postId, actions) {
        this.userActions.set(postId, actions);
        this.saveUserActions();
    }

    getCityName(cityCode) {
        const city = this.cities.find(c => c.code === cityCode);
        return city ? `${city.emoji} ${city.name}` : cityCode;
    }

    getGenderEmoji(gender) {
        const genders = {
            'male': '👨',
            'female': '👩',
            'any': '🤝'
        };
        return genders[gender] || '';
    }

    getReportTypeName(type) {
        const reportTypes = {
            'illegal': '🚫',
            'provocation': '⚡',
            'advertisement': '📢'
        };
        return reportTypes[type] || type;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global functions for onclick handlers
function createPost() {
    window.app.createPost();
}

function cancelCreate() {
    window.app.cancelCreate();
}

function filterPosts() {
    window.app.filterPosts();
}

function resetFilters() {
    window.app.resetFilters();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SocialApp();
});

// Periodic updates
setInterval(() => {
    if (window.app) {
        window.app.renderPosts();
    }
    if (window.network) {
        window.network.updateCounts();
    }
}, 30000);
