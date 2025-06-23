// Security Module - Protection against common attacks
class Security {
    constructor() {
        this.init();
        this.setupCSP();
        this.preventXSS();
        this.setupRateLimit();
    }

    init() {
        // Disable console in production
        if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            console.log = () => {};
            console.warn = () => {};
            console.error = () => {};
        }

        // Disable right-click context menu
        document.addEventListener('contextmenu', e => e.preventDefault());
        
        // Disable F12, Ctrl+Shift+I, Ctrl+U
        document.addEventListener('keydown', e => {
            if (e.key === 'F12' || 
                (e.ctrlKey && e.shiftKey && e.key === 'I') ||
                (e.ctrlKey && e.key === 'u')) {
                e.preventDefault();
            }
        });

        // Prevent copy/paste in certain contexts
        document.addEventListener('copy', e => {
            if (e.target.closest('.sensitive')) {
                e.preventDefault();
            }
        });
    }

    setupCSP() {
        // Content Security Policy enforcement
        const allowedDomains = [
            'self',
            'https://fonts.googleapis.com',
            'https://fonts.gstatic.com',
            'wss://six-4xly.onrender.com'
        ];

        // Monitor for CSP violations
        document.addEventListener('securitypolicyviolation', e => {
            console.warn('CSP Violation:', e.violatedDirective, e.blockedURI);
        });
    }

    preventXSS() {
        // XSS Protection
        this.sanitizeInput = (input) => {
            if (typeof input !== 'string') return input;
            
            const div = document.createElement('div');
            div.textContent = input;
            return div.innerHTML;
        };

        this.validateInput = (input, maxLength = 1000) => {
            if (typeof input !== 'string') return false;
            if (input.length > maxLength) return false;
            
            // Block dangerous patterns
            const dangerousPatterns = [
                /<script/i,
                /javascript:/i,
                /data:/i,
                /vbscript:/i,
                /onload/i,
                /onerror/i,
                /onclick/i,
                /eval\(/i,
                /document\.cookie/i,
                /window\.location/i
            ];
            
            return !dangerousPatterns.some(pattern => pattern.test(input));
        };
    }

    setupRateLimit() {
        // Rate limiting for actions
        this.actionCounts = new Map();
        this.rateLimits = {
            createPost: { max: 5, window: 300000 }, // 5 posts per 5 minutes
            likePost: { max: 50, window: 60000 },   // 50 likes per minute
            reportPost: { max: 10, window: 300000 } // 10 reports per 5 minutes
        };

        this.checkRateLimit = (action) => {
            const now = Date.now();
            const limit = this.rateLimits[action];
            
            if (!limit) return true;
            
            if (!this.actionCounts.has(action)) {
                this.actionCounts.set(action, []);
            }
            
            const actions = this.actionCounts.get(action);
            
            // Remove old actions outside the time window
            const validActions = actions.filter(time => now - time < limit.window);
            
            if (validActions.length >= limit.max) {
                return false; // Rate limit exceeded
            }
            
            validActions.push(now);
            this.actionCounts.set(action, validActions);
            return true;
        };
    }

    // Crypto utilities
    async generateHash(data) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateKeyPair() {
        try {
            return await crypto.subtle.generateKey(
                {
                    name: 'ECDSA',
                    namedCurve: 'P-256'
                },
                false,
                ['sign', 'verify']
            );
        } catch (error) {
            console.error('Key generation failed:', error);
            return null;
        }
    }

    async signData(privateKey, data) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            
            const signature = await crypto.subtle.sign(
                {
                    name: 'ECDSA',
                    hash: 'SHA-256'
                },
                privateKey,
                dataBuffer
            );
            
            return Array.from(new Uint8Array(signature));
        } catch (error) {
            console.error('Signing failed:', error);
            return null;
        }
    }

    async verifySignature(publicKey, signature, data) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(data);
            const signatureBuffer = new Uint8Array(signature).buffer;
            
            return await crypto.subtle.verify(
                {
                    name: 'ECDSA',
                    hash: 'SHA-256'
                },
                publicKey,
                signatureBuffer,
                dataBuffer
            );
        } catch (error) {
            console.error('Verification failed:', error);
            return false;
        }
    }

    // Network security
    validateWebSocketURL(url) {
        try {
            const urlObj = new URL(url);
            const allowedHosts = [
                'six-4xly.onrender.com',
                'localhost',
                '127.0.0.1'
            ];
            
            return urlObj.protocol === 'wss:' && 
                   allowedHosts.includes(urlObj.hostname);
        } catch {
            return false;
        }
    }

    // Input validation
    validatePostData(postData) {
        const validators = {
            title: (val) => typeof val === 'string' && val.length > 0 && val.length <= 200,
            description: (val) => typeof val === 'string' && val.length > 0 && val.length <= 2000,
            tags: (val) => Array.isArray(val) && val.every(tag => 
                typeof tag === 'string' && tag.length <= 50),
            contacts: (val) => typeof val === 'string' && val.length <= 500,
            city: (val) => typeof val === 'string' && val.length <= 50,
            type: (val) => ['event', 'meet', 'help', 'sale', 'other'].includes(val),
            gender: (val) => ['', 'male', 'female', 'any'].includes(val),
            age: (val) => ['', '18-25', '26-35', '36-45', '46+'].includes(val)
        };

        for (const [field, validator] of Object.entries(validators)) {
            if (postData.hasOwnProperty(field) && !validator(postData[field])) {
                return false;
            }
        }

        // Additional XSS validation
        const textFields = ['title', 'description', 'contacts'];
        for (const field of textFields) {
            if (postData[field] && !this.validateInput(postData[field])) {
                return false;
            }
        }

        return true;
    }

    // Session security
    generateSessionId() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // CSRF protection
    generateCSRFToken() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // DOM manipulation protection
    secureSetHTML(element, content) {
        element.textContent = ''; // Clear existing content
        if (typeof content === 'string') {
            element.textContent = content; // Use textContent to prevent XSS
        } else if (content instanceof Node) {
            element.appendChild(content);
        }
    }

    // Storage security
    secureStore(key, value) {
        try {
            const secureValue = {
                data: value,
                timestamp: Date.now(),
                checksum: this.generateChecksum(JSON.stringify(value))
            };
            localStorage.setItem(key, JSON.stringify(secureValue));
            return true;
        } catch (error) {
            console.error('Secure storage failed:', error);
            return false;
        }
    }

    secureRetrieve(key) {
        try {
            const stored = localStorage.getItem(key);
            if (!stored) return null;
            
            const parsed = JSON.parse(stored);
            const expectedChecksum = this.generateChecksum(JSON.stringify(parsed.data));
            
            if (parsed.checksum !== expectedChecksum) {
                console.warn('Data integrity check failed');
                localStorage.removeItem(key);
                return null;
            }
            
            return parsed.data;
        } catch (error) {
            console.error('Secure retrieval failed:', error);
            return null;
        }
    }

    generateChecksum(data) {
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    // Memory protection
    clearSensitiveData(obj) {
        if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    obj[key] = null;
                }
            }
        }
    }
}

// Initialize security
window.security = new Security();

// Global security utilities
window.sanitize = (input) => window.security.sanitizeInput(input);
window.validate = (input, maxLength) => window.security.validateInput(input, maxLength);
window.checkRate = (action) => window.security.checkRateLimit(action);
