const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const cors = require('cors'); // Import cors

// Setup Express
const app = express();
const PORT = 5000;

// Middleware
app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

// MongoDB connection setup
const uri = "mongodb+srv://sarahmorgan9981:4cxwccUmLAL1450h@cluster0.1rk1s.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error: ', err));

// Define User Schema with the new fields
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    password: { type: String, required: true },
    referralsCount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 }
});

// Create User Model
const User = mongoose.model('User', userSchema);


// API to register a user (check if referred)
app.post('/register', async (req, res) => {
    const { firstName, lastName, email, phone, password, referrerId } = req.body;

    try {
        // Check if the user already exists
        const userExists = await User.findOne({ $or: [{ email }, { phone }] });
        if (userExists) {
            return res.status(400).json({ message: 'User with this email or phone already exists' });
        }

        // Create a new user
        const newUser = new User({
            firstName,
            lastName,
            email,
            phone,
            password,
        });

        // If referrerId exists, set the referrer for the new user and update the referrer’s referral count and balance
        if (referrerId) {
            const referrer = await User.findById(referrerId);
            if (!referrer) {
                return res.status(400).json({ message: 'Referrer not found' });
            }

            newUser.referredBy = referrer._id;
            referrer.referrals += 1;  // Increment referral count of the referrer
            referrer.balance += 1000;  // Add a bonus to the referrer's balance
            await referrer.save();
        }

        // Save the new user to the database
        await newUser.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Error creating user' });
    }
});

// API to track referral and update the referrer
app.post('/api/referral', async (req, res) => {
    const { userId, referrerId } = req.body;

    try {
        // Find the referred user by userId
        const user = await User.findById(userId);

        // Check if the user is already referred
        if (user.referredBy) {
            return res.status(400).json({ message: 'User already referred.' });
        }

        const referrer = await User.findById(referrerId);
        if (!referrer) {
            return res.status(400).json({ message: 'Referrer not found.' });
        }

        // Set the referrer for the referred user
        user.referredBy = referrer._id;
        referrer.referrals += 1;  // Increment referrer’s referral count
        referrer.balance += 1000;  // Add bonus to referrer's balance

        // Save the user and referrer data to the database
        await user.save();
        await referrer.save();

        res.status(200).json({ message: 'Referral tracked successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Error tracking referral', error: error.message });
    }
});



app.post('/login', async (req, res) => {
    const { phone, password } = req.body;

    // Find the user by phone number
    const user = await User.findOne({ phone });

    if (!user) {
        return res.status(400).json({ message: 'Invalid phone number or password' });
    }

    // Check if the password matches
    if (user.password !== password) {
        return res.status(400).json({ message: 'Invalid phone number or password' });
    }

    // If login is successful, return the user ID along with the success message
    res.json({
        message: 'Login successful',
        userId: user._id // Return the user ID
    });
});

app.get('/user/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Correct way to instantiate ObjectId with 'new'
        const user = await User.findById(new mongoose.Types.ObjectId(id));

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Return the user data
        res.json({
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            referralsCount: user.referralsCount,
            balance: user.balance
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Error fetching user data' });
    }
});

app.post('/user/deposit', async (req, res) => {
    const { userId, depositAmount } = req.body;
    if (!depositAmount || depositAmount <= 0) {
        return res.status(400).json({ message: 'Invalid deposit amount' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.balance += depositAmount;
        await user.save();

        res.json({ message: 'Balance updated successfully', balance: user.balance });
    } catch (error) {
        res.status(500).json({ message: 'Error processing deposit' });
    }
});

app.post('/user/buy-product', async (req, res) => {
    const { userId, price } = req.body;

    if (!price || price <= 0) {
        return res.status(400).json({ message: 'Invalid product price' });
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.balance >= price) {
            user.balance -= price;  // Deduct the price from the balance

            // Check if `lastPurchase` exists, if not, add it
            if (!user.lastPurchase) {
                user.lastPurchase = new Date();  // Set the lastPurchase time to the current time
            }

            await user.save();

            res.json({ message: 'Purchase successful, bonus will be added in 24 hours.' });
        } else {
            res.status(400).json({ message: 'Insufficient balance' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error processing the purchase' });
    }
});

// Cron job to add 40% bonus to balance every 24 hours
cron.schedule('0 0 * * *', async () => {
    // Run at midnight every day
    const users = await User.find({ lastPurchase: { $exists: true } });

    for (const user of users) {
        const purchaseTime = new Date(user.lastPurchase);
        const currentTime = new Date();

        // Check if 24 hours have passed since the last purchase
        const hoursDifference = (currentTime - purchaseTime) / (1000 * 60 * 60);
        if (hoursDifference >= 24) {
            const bonus = user.balance * 0.40;  // Add 40% bonus of the current balance
            user.balance += bonus;
            user.lastPurchase = null;  // Reset last purchase time after adding the bonus
            await user.save();
            console.log(`Added 40% bonus to user ${user._id}'s balance.`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
