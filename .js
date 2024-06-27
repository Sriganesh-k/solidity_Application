const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const session = require('express-session');

dotenv.config();

console.log('Loaded USERNAME:', process.env.USERNAME);
console.log('Loaded PASSWORD:', process.env.PASSWORD);
console.log('Loaded SESSION_SECRET:', process.env.SESSION_SECRET);

const app = express();
const PORT = 3000;

// MongoDB connection URI
const uri = 'mongodb://localhost:27017';
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

// Connect to MongoDB
async function connectToDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

connectToDB().catch(console.error);

// Middleware to parse form data and JSON
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }  // Set secure to true if using HTTPS
}));

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the HTML form
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle form submission and store data in MongoDB
app.post('/submit', async (req, res) => {
    const {
        first-name,
        last-name,
        age,
        phone,
        address,
        country,
        email,
        ecg-reading,
        bpm,
        privacy-agreement,
        data-access-agreement
    } = req.body;

    // Check if both agreements are accepted
    if (!privacy-agreement || !data-access-agreement) {
        return res.status(400).send('Please accept both privacy regulations and data access agreements.');
    }

    try {
        const db = client.db('employee_db');

        // Insert actual data into the employee_details collection
        const employeeDetailsCollection = db.collection('employee_details');
        const employeeDetails = {
            first_name: first-name,
            last_name: last-name,
            age: age,
            phone: phone,
            address: address,
            country: country,
            email: email,
            ecg_reading: ecg-reading,
            bpm: bpm
        };
        await employeeDetailsCollection.insertOne(employeeDetails);

        // Anonymize data and insert into the employees collection
        const employeesCollection = db.collection('employees');
        const anonymizedData = {
            employee_id: uuidv4(),
            age: age,
            ecg_reading: ecg-reading,
            bpm: bpm
        };
        await employeesCollection.insertOne(anonymizedData);

        console.log('Data inserted successfully');

        res.send(`Form submitted successfully!<br>First Name: ${first-name}<br>Last Name: ${last-name}<br>Age: ${age}<br>Phone: ${phone}<br>Address: ${address}<br>Country: ${country}<br>Email: ${email}<br>ECG Reading: ${ecg-reading}<br>Bpm: ${bpm}`);
    } catch (error) {
        console.error('Error inserting data into MongoDB:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
