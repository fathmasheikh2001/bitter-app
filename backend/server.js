require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Health Check for ALB
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Root route for default AWS Health Check
app.get('/', (req, res) => {
    res.status(200).send('Bitter Backend is Online');
});

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bitter_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// S3 Configuration
const s3 = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.S3_BUCKET_NAME || 'bitter-app-uploads',
        acl: 'public-read',
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const fileName = `profile-pics/${Date.now().toString()}-${file.originalname}`;
            cb(null, fileName);
        }
    })
});

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// --- APIs ---

// 1. Signup
app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hashedPassword]);
        res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 2. Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Login successful', token, username: user.username });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. Get User Profile
app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(users[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 4. Create Tweet
app.post('/api/tweets', authenticateToken, async (req, res) => {
    const { content } = req.body;
    if (!content || content.length > 280) return res.status(400).json({ error: 'Content is required and must be under 280 characters' });

    try {
        const [result] = await pool.query('INSERT INTO tweets (user_id, content) VALUES (?, ?)', [req.user.id, content]);
        res.status(201).json({ message: 'Tweet created', tweetId: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 5. Get Feed
app.get('/api/feed', async (req, res) => {
    const { filter } = req.query;
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    let query = `
        SELECT tweets.id, tweets.content, tweets.created_at, users.username, users.id as user_id, users.profile_pic_url 
        FROM tweets 
        JOIN users ON tweets.user_id = users.id 
    `;

    try {
        if (filter === 'following' && token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            query += ` WHERE users.id IN (SELECT followed_id FROM followers WHERE follower_id = ?) OR users.id = ? `;
            query += ` ORDER BY tweets.created_at DESC LIMIT 50 `;
            const [tweets] = await pool.query(query, [decoded.id, decoded.id]);
            return res.json(tweets);
        }

        query += ` ORDER BY tweets.created_at DESC LIMIT 50 `;
        const [tweets] = await pool.query(query);
        res.json(tweets);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error or Invalid token' });
    }
});

// 6. Get Users (for suggestions)
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const query = `
            SELECT id, username, profile_pic_url 
            FROM users 
            WHERE id != ? 
            AND id NOT IN (SELECT followed_id FROM followers WHERE follower_id = ?)
            LIMIT 10
        `;
        const [users] = await pool.query(query, [req.user.id, req.user.id]);
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 7. Follow User
app.post('/api/follow/:id', authenticateToken, async (req, res) => {
    const followedId = req.params.id;
    if (followedId == req.user.id) return res.status(400).json({ error: "You can't follow yourself" });

    try {
        await pool.query('INSERT IGNORE INTO followers (follower_id, followed_id) VALUES (?, ?)', [req.user.id, followedId]);
        res.json({ message: 'Followed successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 8. Unfollow User
app.delete('/api/follow/:id', authenticateToken, async (req, res) => {
    const followedId = req.params.id;
    try {
        await pool.query('DELETE FROM followers WHERE follower_id = ? AND followed_id = ?', [req.user.id, followedId]);
        res.json({ message: 'Unfollowed successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 9. Get Following List
app.get('/api/following', authenticateToken, async (req, res) => {
    try {
        const [following] = await pool.query('SELECT followed_id FROM followers WHERE follower_id = ?', [req.user.id]);
        res.json(following.map(f => f.followed_id));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// 10. Search Users
app.get('/api/users/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    try {
        const [users] = await pool.query('SELECT id, username, profile_pic_url FROM users WHERE username LIKE ? LIMIT 10', [`%${q}%`]);
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 11. Get User Profile
app.get('/api/users/profile/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const [users] = await pool.query('SELECT id, username, profile_pic_url, bio, created_at FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });
        
        const user = users[0];
        const [followers] = await pool.query('SELECT COUNT(*) as count FROM followers WHERE followed_id = ?', [user.id]);
        const [following] = await pool.query('SELECT COUNT(*) as count FROM followers WHERE follower_id = ?', [user.id]);
        
        res.json({ ...user, followerCount: followers[0].count, followingCount: following[0].count });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 12. Get User Tweets
app.get('/api/users/:userId/tweets', async (req, res) => {
    try {
        const [tweets] = await pool.query(`
            SELECT tweets.*, users.username, users.profile_pic_url 
            FROM tweets 
            JOIN users ON tweets.user_id = users.id 
            WHERE tweets.user_id = ? 
            ORDER BY created_at DESC
        `, [req.params.userId]);
        res.json(tweets);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// 13. Update Profile
app.put('/api/user/profile', authenticateToken, upload.single('profilePic'), async (req, res) => {
    const { bio } = req.body;
    const profilePicUrl = req.file ? req.file.location : null;

    try {
        if (profilePicUrl && bio) {
            await pool.query('UPDATE users SET bio = ?, profile_pic_url = ? WHERE id = ?', [bio, profilePicUrl, req.user.id]);
        } else if (profilePicUrl) {
            await pool.query('UPDATE users SET profile_pic_url = ? WHERE id = ?', [profilePicUrl, req.user.id]);
        } else if (bio) {
            await pool.query('UPDATE users SET bio = ? WHERE id = ?', [bio, req.user.id]);
        }
        res.json({ message: 'Profile updated successfully', profilePicUrl });
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
