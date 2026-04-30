// 🚀 DEPLOYMENT CONFIGURATION
// Update the IP below whenever you launch a new EC2 instance!
const API_URL = '/api'; 
let followingList = [];
let currentTab = 'global';

// --- Utilities ---
function getToken() { return localStorage.getItem('token'); }
function getUsername() { return localStorage.getItem('username'); }

function logout() {
    localStorage.clear();
    window.location.href = 'auth.html';
}

function showProfile(username) {
    if (!username) username = getUsername();
    window.location.href = `profile.html?user=${username}`;
}


function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    if (diffInSeconds < 60) return `${diffInSeconds}s`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
    return date.toLocaleDateString();
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (!getToken() && !window.location.pathname.includes('auth.html')) {
        window.location.href = 'auth.html';
        return;
    }

    if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
        initHome();
    } else if (window.location.pathname.includes('profile.html')) {
        const urlParams = new URLSearchParams(window.location.search);
        const user = urlParams.get('user') || getUsername();
        initProfile(user);
    }

    // Set avatar for current user in sidebar/tweetbox
    const userAvatar = document.getElementById('current-user-avatar');
    if (userAvatar) {
        userAvatar.src = localStorage.getItem('profile_pic') || 'https://bitter-app-uploads.s3.ap-south-1.amazonaws.com/default-avatar.png';
    }

    setupGlobalListeners();
});

async function initHome() {
    await loadFollowing();
    loadFeed();
}

// --- Feed Logic ---
async function loadFeed() {
    const container = document.getElementById('feed-container');
    if (!container) return;
    
    container.innerHTML = '<div style="padding: 20px; text-align: center;">Loading...</div>';

    try {
        const url = `${API_URL}/feed${currentTab === 'following' ? '?filter=following' : ''}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const tweets = await response.json();
        container.innerHTML = '';

        if (tweets.length === 0) {
            container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">No tweets found. Try following someone!</div>';
            return;
        }

        tweets.forEach(tweet => {
            const tweetDiv = renderTweetItem(tweet);
            container.appendChild(tweetDiv);
        });
    } catch (e) {
        showToast("Failed to load feed");
    }
}

function renderTweetItem(tweet) {
    const isFollowing = followingList.includes(tweet.user_id);
    const isSelf = tweet.username === getUsername();
    
    const div = document.createElement('div');
    div.className = 'tweet';
    div.onclick = (e) => {
        if (!e.target.closest('button')) window.location.href = `profile.html?user=${tweet.username}`;
    };

    div.innerHTML = `
        <img src="${tweet.profile_pic_url || 'https://bitter-app-uploads.s3.ap-south-1.amazonaws.com/default-avatar.png'}" class="avatar" alt="Avatar">
        <div class="tweet-body">
            <div class="tweet-meta">
                <div class="user-info">
                    <span class="username">${tweet.username}</span>
                    <span class="handle">@${tweet.username}</span>
                    <span class="time">· ${timeAgo(tweet.created_at)}</span>
                </div>
                ${!isSelf ? `
                    <button class="btn btn-outline follow-btn ${isFollowing ? 'unfollow-btn' : ''}" style="padding: 4px 12px; font-size: 13px;"
                            onclick="event.stopPropagation(); toggleFollow(${tweet.user_id}, ${isFollowing})">
                        ${isFollowing ? 'Unfollow' : 'Follow'}
                    </button>
                ` : ''}
            </div>
            <div class="content">${tweet.content}</div>
        </div>
    `;
    return div;
}

function switchTab(tab) {
    currentTab = tab;
    const globalTab = document.getElementById('tab-global');
    const followingTab = document.getElementById('tab-following');
    
    if (globalTab) globalTab.classList.toggle('active', tab === 'global');
    if (followingTab) followingTab.classList.toggle('active', tab === 'following');
    
    loadFeed();
}

// --- Profile Logic ---
async function initProfile(username) {
    await loadFollowing();
    try {
        const response = await fetch(`${API_URL}/users/profile/${username}`);
        const user = await response.json();
        
        document.getElementById('profile-display-name').innerText = user.username;
        document.getElementById('profile-username').innerText = user.username;
        document.getElementById('profile-handle').innerText = `@${user.username}`;
        document.getElementById('profile-bio').innerText = user.bio || "No bio provided.";
        document.getElementById('profile-avatar').src = user.profile_pic_url || 'https://bitter-app-uploads.s3.ap-south-1.amazonaws.com/default-avatar.png';
        document.getElementById('followers-count').innerHTML = `<b>${user.followerCount}</b> Followers`;
        document.getElementById('following-count').innerHTML = `<b>${user.followingCount}</b> Following`;

        const actionsDiv = document.getElementById('profile-actions');
        if (username === getUsername()) {
            actionsDiv.innerHTML = `<button class="btn btn-primary" onclick="openEditModal()">Edit Profile</button>`;
        } else {
            const isFollowing = followingList.includes(user.id);
            actionsDiv.innerHTML = `
                <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" onclick="toggleFollow(${user.id}, ${isFollowing})">
                    ${isFollowing ? 'Unfollow' : 'Follow'}
                </button>`;
        }

        loadUserTweets(user.id);
    } catch (e) {
        showToast("User not found");
    }
}

async function loadUserTweets(userId) {
    const container = document.getElementById('feed-container');
    const response = await fetch(`${API_URL}/users/${userId}/tweets`);
    const tweets = await response.json();
    container.innerHTML = '';
    
    document.getElementById('tweet-count').innerText = `${tweets.length} tweets`;
    
    tweets.forEach(tweet => {
        container.appendChild(renderTweetItem(tweet));
    });
}

// --- Following ---
async function loadFollowing() {
    try {
        const response = await fetch(`${API_URL}/following`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        followingList = await response.json();
    } catch (e) {}
}

async function toggleFollow(id, isFollowing) {
    const method = isFollowing ? 'DELETE' : 'POST';
    const response = await fetch(`${API_URL}/follow/${id}`, {
        method: method,
        headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (response.ok) {
        showToast(isFollowing ? "Unfollowed" : "Followed");
        await loadFollowing();
        if (window.location.pathname.includes('profile.html')) {
            const urlParams = new URLSearchParams(window.location.search);
            initProfile(urlParams.get('user') || getUsername());
        } else {
            loadFeed();
        }
    }
}

// --- Search ---
let searchTimeout;
function handleSearch(q, isMobile = false) {
    clearTimeout(searchTimeout);
    const containerId = isMobile ? 'mobile-search-results' : 'search-results';
    const listId = isMobile ? 'mobile-results-list' : 'results-list';
    
    const container = document.getElementById(containerId);
    const list = document.getElementById(listId);
    
    if (!container || !list) return;
    if (!q) { container.style.display = 'none'; return; }

    searchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_URL}/users/search?q=${q}`);
            const users = await response.json();
            
            container.style.display = 'block';
            list.innerHTML = '';
            
            if (users.length === 0) {
                list.innerHTML = '<div style="padding: 10px; font-size: 14px; color: var(--text-muted);">No users found</div>';
                return;
            }

            users.forEach(user => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.style.cursor = 'pointer';
                item.onclick = () => window.location.href = `profile.html?user=${user.username}`;
                item.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${user.profile_pic_url || 'https://bitter-app-uploads.s3.ap-south-1.amazonaws.com/default-avatar.png'}" class="avatar" style="width: 36px; height: 36px;">
                        <div>
                            <div style="font-weight: bold; font-size: 14px;">${user.username}</div>
                            <div style="font-size: 12px; color: var(--text-muted);">@${user.username}</div>
                        </div>
                    </div>
                `;
                list.appendChild(item);
            });
        } catch (e) {
            console.error("Search Error:", e);
        }
    }, 300);
}

// --- Edit Profile ---
function openEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.getElementById('edit-bio').value = document.getElementById('profile-bio').innerText;
    }
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    if (modal) modal.style.display = 'none';
}

async function saveProfile() {
    const bio = document.getElementById('edit-bio').value;
    const file = document.getElementById('profile-pic-input').files[0];
    
    const formData = new FormData();
    formData.append('bio', bio);
    if (file) formData.append('profilePic', file);

    try {
        const response = await fetch(`${API_URL}/user/profile`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            showToast("Profile Updated!");
            if (data.profilePicUrl) {
                localStorage.setItem('profile_pic', data.profilePicUrl);
                // Update all instances of user avatar on current page
                document.querySelectorAll('.avatar[src*="default-avatar"], #current-user-avatar').forEach(img => {
                    if (img.id === 'current-user-avatar' || img.closest('.tweet-body') === null) {
                        img.src = data.profilePicUrl;
                    }
                });
            }
            closeEditModal();
            initProfile(getUsername());
        } else {
            showToast(data.error || "Failed to update profile");
            console.error("Save Error Response:", data);
        }
    } catch (e) {
        console.error("Profile Save Error:", e);
        showToast("Error connecting to server");
    }
}

// --- Global Listeners ---
function setupGlobalListeners() {
    const postBtn = document.getElementById('tweet-btn');
    if (postBtn) {
        postBtn.onclick = async () => {
            const content = document.getElementById('tweet-input').value;
            if (!content.trim()) return;
            const res = await fetch(`${API_URL}/tweets`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify({ content })
            });
            if (res.ok) {
                document.getElementById('tweet-input').value = '';
                showToast("Post sent!");
                loadFeed();
            } else {
                const errData = await res.json();
                console.error("Post Error:", errData);
                showToast(errData.error || "Failed to post");
            }
        };
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.oninput = (e) => handleSearch(e.target.value, false);
    }

    const mobileSearchInput = document.getElementById('mobile-search-input');
    if (mobileSearchInput) {
        mobileSearchInput.oninput = (e) => handleSearch(e.target.value, true);
    }

    const authForm = document.getElementById('auth-form');
    if (authForm) {
        let mode = 'login';
        document.getElementById('toggle-mode').onclick = () => {
            mode = mode === 'login' ? 'signup' : 'login';
            document.getElementById('form-title').innerText = mode === 'login' ? 'Log in to Bitter' : 'Join Bitter today';
            document.getElementById('submit-btn').innerText = mode === 'login' ? 'Log in' : 'Sign up';
            document.getElementById('toggle-mode').innerText = mode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Log in";
        };

        authForm.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const response = await fetch(`${API_URL}/${mode}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (response.ok) {
                if (mode === 'signup') {
                    showToast("Account created! Logging in...");
                    mode = 'login';
                    authForm.dispatchEvent(new Event('submit'));
                } else {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('username', data.username);
                    window.location.href = 'index.html';
                }
            } else {
                showToast(data.error || "Error");
            }
        };
    }
}
