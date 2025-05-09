require('dotenv').config()

const mongoose = require('mongoose');
const express = require('express');
const app = express();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const corsOptions = {
    method: 'GET',
    optionsSuccessStatus: 200
};

// Middleware
// In your backend (Node.js/Express)
app.use(cors(corsOptions));
app.use(express.json()); // to parse JSON bodies
app.use(express.urlencoded({ extended: true }));

// Configure storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});


const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// Database connection
mongoose.connect(`${process.env.MONGO_URL}`)
.then(() => {
    console.log('Connected to MongoDB');
})
.catch((error) => {
    console.log('Error connecting to MongoDB:', error);
});

// Updated User schema with profile image
const userSchema = new mongoose.Schema({
    name: String,
    age: Number,
    uniqueId: { type: String, unique: true },
    profileImage: String // Store the filename of the uploaded image
});

const User = mongoose.model('User', userSchema);

// Updated /add-user route with file upload support
app.post('/add-user', upload.single('profileImage'), async (req, res) => {
    try {
        const { name, age, uniqueId } = req.body;
        
        // Basic validation
        if (!name || !age || !uniqueId) {
            // If there was a file uploaded but validation failed, delete it
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ 
                success: false,
                message: 'All fields (name, age, uniqueId) are required' 
            });
        }

        const ageNum = parseInt(age);
        if (isNaN(ageNum)) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: 'Age must be a valid number'
            });
        }

        const userData = {
            name,
            age: ageNum,
            uniqueId,
            profileImage: req.file ? req.file.filename : null
        };

        const user = new User(userData);
        await user.save();
        
        res.json({ 
            success: true,
            message: 'User saved successfully!',
            user 
        });
    } catch (error) {
        console.error('Error saving user:', error);
        
        // If there was a file uploaded but an error occurred, delete it
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        
        let errorMessage = 'Error saving user';
        if (error.code === 11000) { // MongoDB duplicate key error
            errorMessage = `User with uniqueId "${error.keyValue.uniqueId}" already exists`;
        } else if (error.name === 'ValidationError') {
            errorMessage = Object.values(error.errors).map(val => val.message).join(', ');
        }
        
        res.status(500).json({ 
            success: false,
            message: errorMessage,
            error: error.message 
        });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await User.find();
        res.send(users);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching users');
    }
});

const cache = {};

app.get('/users/:uniqueId', async (req, res) => {
    try {
        const { uniqueId } = req.params;
        
        // Check cache first
        if (cache[uniqueId] && cache[uniqueId].expires > Date.now()) {
            return res.json({
                success: true,
                user: cache[uniqueId].data,
                cached: true
            });
        }
        
        const user = await User.findOne({ uniqueId });
        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: 'User not found'
            });
        }
        
        // Cache the result for 5 minutes
        cache[uniqueId] = {
            data: user,
            expires: Date.now() + 300000
        };
        
        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user',
            error: error.message
        });
    }
});

// Add a route to delete users (optional but useful for cleanup)
app.delete('/user/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).send('User not found');
        }
        
        // Delete the associated profile image if it exists
        if (user.profileImage) {
            const imagePath = path.join(__dirname, 'uploads', user.profileImage);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }
        
        res.send({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error deleting user');
    }
});

app.listen(process.env.PORT, () => {
    console.log('Server started on port ', process.env.PORT);
});