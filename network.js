// P2P Network Manager
class NetworkManager {
    constructor() {
        this.friends = new Map();
        this.connections = new Map();
        this.rtcConnections = new Map();
        this.myId = this.generateId();
        this.crdt = new CRDT();
        this.isConnected = false;
        this.isOnline = navigator.onLine;
        this.signalingSocket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.heartbeatInterval = null;
        
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
        ];
        
        this.init();
    }

    generateId() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async init() {
        try {
            // Load saved state
            await this.loadState();
            
            // Setup event listeners
            this.setupNetworkEventListeners();
            
            // Register service worker
            await this.registerServiceWorker();
            
            // Start network connection
            await this.initNetwork();
            
            // Start periodic tasks
            this.startPeriodicTasks();
            
        } catch (error) {
            console.error('Network initialization failed:', error);
            this.updateStatus('❌');
        }
    }

    async loadState() {
        try {
            const savedId = await window.storage.loadNetworkState('myId');
            if (savedId) {
                this.myId = savedId;
            } else {
                await window.storage.saveNetworkState('myId', this.myId);
            }

            const savedCRDT = await window.storage.loadNetworkState('crdt');
            if (savedCRDT) {
                this.crdt.deserializeAndMerge(savedCRDT);
            }
        } catch (error) {
            console.error('Failed to load network state:', error);
        }
    }

    async saveState() {
        try {
            await window.storage.saveNetworkState('myId', this.myId);
            await window.storage.saveNetworkState('crdt', this.crdt.serialize());
        } catch (error) {
            console.error('Failed to save network state:', error);
        }
    }

    setupNetworkEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateStatus('🔄');
            this.reconnectAttempts = 0;
            this.initNetwork();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isConnected = false;
            this.updateStatus('📴');
            this.closeAllConnections();
        });

        window.addEventListener('beforeunload', () => {
            this.disconnect();
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.isOnline && !this.isConnected) {
                this.initNetwork();
            }
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('./sw.js');
                console.log('Service Worker registered');
                
                navigator.serviceWorker.addEventListener('message', event => {
                    this.handleServiceWorkerMessage(event.data);
                });
                
                if ('sync' in window.ServiceWorkerRegistration.prototype) {
                    registration.sync.register('sync-posts');
                }
                
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    handleServiceWorkerMessage(data) {
        switch (data.type) {
            case 'SYNC_COMPLETE':
                console.log('Background sync completed');
                this.broadcastMyData();
                break;
        }
    }

    async initNetwork() {
        if (!this.isOnline) {
            this.startLocalMode();
            return;
        }

        try {
            this.updateStatus('🔄');
            await this.connectToSignalingServer();
        } catch (error) {
            console.error('Network connection failed:', error);
            this.updateStatus('📴');
            this.startLocalMode();
        }
    }

    async connectToSignalingServer() {
        const signalingUrl = 'wss://six-4xly.onrender.com';
        
        if (!window.security.validateWebSocketURL(signalingUrl)) {
            throw new Error('Invalid signaling server URL');
        }

        return new Promise((resolve, reject) => {
            this.signalingSocket = new WebSocket(signalingUrl);
            
            this.signalingSocket.onopen = () => {
                console.log('🔗 Connected to signaling server');
                this.isConnected = true;
                this.updateStatus('live');
                this.reconnectAttempts = 0;
                this.startHeartbeat();
                this.announcePresence();
                resolve();
            };

            this.signalingSocket.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.from !== this.myId) {
                        await this.handleSignalingMessage(message);
                    }
                } catch (error) {
                    console.error('Failed to handle signaling message:', error);
                }
            };

            this.signalingSocket.onclose = () => {
                console.log('❌ Signaling connection closed');
                this.isConnected = false;
                this.stopHeartbeat();
                this.handleDisconnection();
            };

            this.signalingSocket.onerror = (error) => {
                console.error('Signaling error:', error);
                reject(error);
            };

            setTimeout(() => {
                if (this.signalingSocket.readyState !== WebSocket.OPEN) {
                    this.signalingSocket.close();
                    reject(new Error('Connection timeout'));
                }
            }, 10000);
        });
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
                this.sendSignalingMessage({ type: 'heartbeat' });
            }
        }, 30000); // 30 seconds
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    handleDisconnection() {
        this.updateStatus('🔄');
        
        if (this.reconnectAttempts < this.maxReconnectAttempts && this.isOnline) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            this.reconnectAttempts++;
            
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
            setTimeout(() => this.connectToSignalingServer(), delay);
        } else {
            this.updateStatus('📴');
            this.startLocalMode();
        }
    }

    startLocalMode() {
        this.updateStatus('🏠');
        this.simulateLocalNetwork();
    }

    simulateLocalNetwork() {
        // Create demo friends and posts for offline mode
        const demoFriends = [
            { id: 'demo_1', name: '👨‍💼' },
            { id: 'demo_2', name: '👩‍🎨' },
            { id: 'demo_3', name: '👨‍🔬' }
        ];

        demoFriends.forEach(friend => {
            this.friends.set(friend.id, {
                ...friend,
                connected: true,
                lastSeen: Date.now()
            });
        });

        this.updateCounts();
    }

    announcePresence() {
        this.sendSignalingMessage({
            type: 'announce',
            target: 'all',
            peerId: this.myId,
            userAgent: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'
        });
    }

    sendSignalingMessage(message) {
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            const wrappedMessage = {
                ...message,
                from: this.myId,
                timestamp: Date.now()
            };
            
            try {
                this.signalingSocket.send(JSON.stringify(wrappedMessage));
                return true;
            } catch (error) {
                console.error('Failed to send signaling message:', error);
                return false;
            }
        }
        return false;
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'announce':
                if (message.peerId !== this.myId) {
                    console.log(`👋 New friend: ${message.peerId}`);
                    if (this.myId > message.peerId) {
                        setTimeout(() => {
                            this.connectToFriend(message.peerId);
                        }, Math.random() * 2000);
                    }
                }
                break;
            case 'offer':
                await this.handleOffer(message);
                break;
            case 'answer':
                await this.handleAnswer(message);
                break;
            case 'ice-candidate':
                await this.handleIceCandidate(message);
                break;
            case 'heartbeat':
                // Heartbeat received, connection is alive
                break;
        }
    }

    async connectToFriend(friendId) {
        if (this.connections.has(friendId) || this.rtcConnections.has(friendId)) {
            return;
        }

        try {
            const connection = await this.createRTCConnection(friendId);
            
            const offer = await connection.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });
            await connection.setLocalDescription(offer);

            this.sendSignalingMessage({
                type: 'offer',
                target: friendId,
                offer: offer
            });

        } catch (error) {
            console.error(`Failed to connect to friend ${friendId}:`, error);
            this.handleFriendDisconnection(friendId);
        }
    }

    async createRTCConnection(friendId) {
        if (this.rtcConnections.has(friendId)) {
            return this.rtcConnections.get(friendId);
        }

        const connection = new RTCPeerConnection({ iceServers: this.iceServers });
        this.rtcConnections.set(friendId, connection);
        
        const dataChannel = connection.createDataChannel('posts', {
            ordered: true,
            maxRetransmits: 3
        });

        this.setupDataChannel(dataChannel, friendId);
        
        connection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, friendId);
        };

        connection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage({
                    type: 'ice-candidate',
                    target: friendId,
                    candidate: event.candidate
                });
            }
        };

        connection.onconnectionstatechange = () => {
            if (connection.connectionState === 'connected') {
                this.friends.set(friendId, {
                    id: friendId,
                    connected: true,
                    lastSeen: Date.now()
                });
                this.updateCounts();
            } else if (connection.connectionState === 'failed' || 
                       connection.connectionState === 'disconnected') {
                this.handleFriendDisconnection(friendId);
            }
        };

        return connection;
    }

    setupDataChannel(dataChannel, friendId) {
        dataChannel.onopen = () => {
            console.log(`📡 Data channel opened with ${friendId}`);
            this.connections.set(friendId, dataChannel);
            
            this.sendToFriend(friendId, {
                type: 'sync',
                data: this.crdt.serialize()
            });
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleFriendMessage(friendId, message);
            } catch (error) {
                console.error('Failed to parse friend message:', error);
            }
        };

        dataChannel.onclose = () => {
            console.log(`📡 Data channel closed with ${friendId}`);
            this.handleFriendDisconnection(friendId);
        };

        dataChannel.onerror = (error) => {
            console.error(`Data channel error with ${friendId}:`, error);
        };
    }

    handleFriendDisconnection(friendId) {
        this.connections.delete(friendId);
        this.friends.delete(friendId);
        
        const rtcConnection = this.rtcConnections.get(friendId);
        if (rtcConnection) {
            rtcConnection.close();
            this.rtcConnections.delete(friendId);
        }
        
        this.updateCounts();
    }

    sendToFriend(friendId, message) {
        const dataChannel = this.connections.get(friendId);
        if (dataChannel && dataChannel.readyState === 'open') {
            try {
                dataChannel.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error(`Failed to send message to friend ${friendId}:`, error);
                return false;
            }
        }
        return false;
    }

    async handleOffer(message) {
        try {
            const connection = await this.createRTCConnection(message.from);
            
            await connection.setRemoteDescription(new RTCSessionDescription(message.offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);

            this.sendSignalingMessage({
                type: 'answer',
                target: message.from,
                answer: answer
            });

        } catch (error) {
            console.error(`Failed to handle offer from ${message.from}:`, error);
        }
    }

    async handleAnswer(message) {
        try {
            const connection = this.rtcConnections.get(message.from);
            if (connection) {
                await connection.setRemoteDescription(new RTCSessionDescription(message.answer));
            }
        } catch (error) {
            console.error(`Failed to handle answer from ${message.from}:`, error);
        }
    }

    async handleIceCandidate(message) {
        try {
            const connection = this.rtcConnections.get(message.from);
            if (connection && message.candidate) {
                await connection.addIceCandidate(new RTCIceCandidate(message.candidate));
            }
        } catch (error) {
            console.error(`Failed to handle ICE candidate from ${message.from}:`, error);
        }
    }

    handleFriendMessage(friendId, message) {
        switch (message.type) {
            case 'sync':
                this.handleSync(friendId, message.data);
                break;
            case 'post':
                this.handleNewPost(friendId, message.data);
                break;
            case 'like':
                this.handleLike(friendId, message.data);
                break;
            case 'report':
                this.handleReport(friendId, message.data);
                break;
        }
    }

    handleSync(fromFriendId, syncData) {
        try {
            const updated = this.crdt.deserializeAndMerge(syncData);
            
            if (updated) {
                console.log(`🔄 Synced with ${fromFriendId}`);
                this.saveState();
                if (window.app) window.app.renderPosts();
                this.updateCounts();
            }
        } catch (error) {
            console.error('Sync failed:', error);
        }
    }

    handleNewPost(fromFriendId, postData) {
        try {
            if (this.crdt.update(postData.id, postData, postData.timestamp)) {
                console.log(`📝 New post from ${fromFriendId}`);
                this.saveState();
                if (window.app) window.app.renderPosts();
                this.updateCounts();
                
                this.relayMessage(fromFriendId, {
                    type: 'post',
                    data: postData
                });
            }
        } catch (error) {
            console.error('Failed to handle new post:', error);
        }
    }

    handleLike(fromFriendId, likeData) {
        try {
            const post = this.crdt.get(likeData.postId);
            if (post) {
                let updated = false;
                
                if (likeData.action === 'like') {
                    if (!post.likedBy.includes(likeData.userId)) {
                        post.likes = (post.likes || 0) + 1;
                        post.likedBy = post.likedBy || [];
                        post.likedBy.push(likeData.userId);
                        updated = true;
                    }
                } else if (likeData.action === 'unlike') {
                    if (post.likedBy.includes(likeData.userId)) {
                        post.likes = Math.max(0, (post.likes || 0) - 1);
                        post.likedBy = post.likedBy.filter(id => id !== likeData.userId);
                        updated = true;
                    }
                }
                
                if (updated) {
                    this.crdt.update(post.id, post);
                    this.saveState();
                    if (window.app) window.app.renderPosts();
                    
                    this.relayMessage(fromFriendId, {
                        type: 'like',
                        data: likeData
                    });
                }
            }
        } catch (error) {
            console.error('Failed to handle like:', error);
        }
    }

    handleReport(fromFriendId, reportData) {
        try {
            const post = this.crdt.get(reportData.postId);
            if (post) {
                post.reports = post.reports || { illegal: 0, provocation: 0, advertisement: 0 };
                post.reports[reportData.reportType] = (post.reports[reportData.reportType] || 0) + 1;
                
                if (post.reports[reportData.reportType] >= 10) {
                    post.flagged = reportData.reportType;
                }

                this.crdt.update(post.id, post);
                this.saveState();
                if (window.app) window.app.renderPosts();
                
                this.relayMessage(fromFriendId, {
                    type: 'report',
                    data: reportData
                });
            }
        } catch (error) {
            console.error('Failed to handle report:', error);
        }
    }

    relayMessage(excludeFriendId, message) {
        for (const [friendId, channel] of this.connections) {
            if (friendId !== excludeFriendId && channel.readyState === 'open') {
                this.sendToFriend(friendId, message);
            }
        }
    }

    broadcast(message) {
        let successCount = 0;
        for (const [friendId] of this.connections) {
            if (this.sendToFriend(friendId, message)) {
                successCount++;
            }
        }
        return successCount;
    }

    broadcastMyData() {
        if (this.connections.size > 0) {
            this.broadcast({
                type: 'sync',
                data: this.crdt.serialize()
            });
        }
    }

    closeAllConnections() {
        for (const [friendId, connection] of this.rtcConnections) {
            connection.close();
        }
        this.rtcConnections.clear();
        
        for (const [friendId, channel] of this.connections) {
            channel.close();
        }
        this.connections.clear();
        
        if (this.signalingSocket) {
            this.signalingSocket.close();
            this.signalingSocket = null;
        }
        
        this.stopHeartbeat();
        this.friends.clear();
        this.updateCounts();
    }

    disconnect() {
        this.closeAllConnections();
        this.isConnected = false;
        this.updateStatus('📴');
    }

    updateStatus(text) {
        const statusText = document.getElementById('statusText');
        const statusDot = document.getElementById('statusDot');
        
        if (statusText) statusText.textContent = text;
        if (statusDot) {
            statusDot.className = `status-dot ${this.isConnected ? 'connected' : ''}`;
        }
        
        this.updateCounts();
    }

    updateCounts() {
        const friendCount = document.getElementById('friendCount');
        const postCount = document.getElementById('postCount');
        
        if (friendCount) friendCount.textContent = `👥 ${this.friends.size}`;
        if (postCount) postCount.textContent = `📝 ${this.getAllPosts().length}`;
    }

    getAllPosts() {
        const posts = [];
        for (const [id, post] of this.crdt.getAll()) {
            if (post.expiresAt > Date.now()) {
                posts.push(post);
            }
        }
        return posts;
    }

    startPeriodicTasks() {
        // Save state every 30 seconds
        setInterval(() => {
            this.saveState();
        }, 30000);

        // Broadcast data every 60 seconds
        setInterval(() => {
            if (this.isConnected) {
                this.broadcastMyData();
            }
        }, 60000);

        // Clean up expired posts every 10 minutes
        setInterval(() => {
            this.cleanupExpiredPosts();
        }, 600000);
    }

    cleanupExpiredPosts() {
        const now = Date.now();
        let cleaned = false;
        
        for (const [id, post] of this.crdt.getAll()) {
            if (post.expiresAt <= now) {
                if (post.author === this.myId) {
                    post.status = 'expired';
                    this.crdt.update(id, post);
                } else {
                    this.crdt.delete(id);
                }
                cleaned = true;
            }
        }
        
        if (cleaned) {
            this.saveState();
            if (window.app) window.app.renderPosts();
            this.updateCounts();
        }
    }
}

// CRDT Implementation
class CRDT {
    constructor() {
        this.state = new Map();
        this.vectorClock = new Map();
        this.nodeId = this.generateNodeId();
    }

    generateNodeId() {
        const array = new Uint8Array(8);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    update(key, value, timestamp = Date.now()) {
        const currentClock = this.vectorClock.get(this.nodeId) || 0;
        this.vectorClock.set(this.nodeId, Math.max(currentClock, timestamp));
        
        const entry = {
            value,
            timestamp,
            nodeId: this.nodeId,
            vectorClock: new Map(this.vectorClock)
        };

        if (!this.state.has(key) || this.shouldUpdate(this.state.get(key), entry)) {
            this.state.set(key, entry);
            return true;
        }
        return false;
    }

    shouldUpdate(existing, incoming) {
        if (incoming.timestamp > existing.timestamp) return true;
        if (incoming.timestamp === existing.timestamp) {
            return incoming.nodeId > existing.nodeId;
        }
        return false;
    }

    merge(otherState) {
        let updated = false;
        for (const [key, entry] of otherState) {
            if (!this.state.has(key) || this.shouldUpdate(this.state.get(key), entry)) {
                this.state.set(key, entry);
                updated = true;
            }
            
            const incomingClock = entry.vectorClock.get(entry.nodeId) || 0;
            const currentClock = this.vectorClock.get(entry.nodeId) || 0;
            this.vectorClock.set(entry.nodeId, Math.max(currentClock, incomingClock));
        }
        return updated;
    }

    get(key) {
        const entry = this.state.get(key);
        return entry ? entry.value : undefined;
    }

    getAll() {
        const result = new Map();
        for (const [key, entry] of this.state) {
            result.set(key, entry.value);
        }
        return result;
    }

    delete(key) {
        this.state.delete(key);
    }

    serialize() {
        return JSON.stringify([...this.state], (key, value) => {
            if (value instanceof Map) {
                return [...value];
            }
            return value;
        });
    }

    deserializeAndMerge(data) {
        try {
            const parsed = JSON.parse(data, (key, value) => {
                if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
                    return new Map(value);
                }
                return value;
            });
            const otherState = new Map(parsed);
            return this.merge(otherState);
        } catch (error) {
            console.error('Failed to deserialize CRDT data:', error);
            return false;
        }
    }
}

// Initialize network manager
window.network = new NetworkManager();
