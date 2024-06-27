const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const session = require('express-session');
const fs = require('fs');
const Ajv = require('ajv');

dotenv.config();

const ajv = new Ajv();

// Define custom format for email validation
ajv.addFormat('email', (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
});

// Define the JSON schema with email format validation
const schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "firstName": { "type": "string" },
        "lastName": { "type": "string" },
        "age": { "type": "integer" },
        "phone": { "type": "string" },
        "address": { "type": "string" },
        "country": { "type": "string" },
        "email": { "type": "string", "format": "email" }
    },
    "required": ["firstName", "lastName", "age", "phone", "address", "country", "email"]
};

const validate = ajv.compile(schema);

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection URI
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

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

// Serve the login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Handle login
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        req.session.isAuthenticated = true;
        res.redirect('/anonymized-data');
    } else {
        res.status(401).send('Invalid username or password');
    }
});

// Anonymize data function
function anonymizeData(data) {
    return {
        employee_id: uuidv4(),
        age: parseInt(data.age),
        ecg_reading: parseInt(data.ecgReading),
        bpm: parseInt(data.bpm)
    };
}

//Function to save data locally
function saveDataLocally(directory, filename, data) {
    const dirPath = path.join(__dirname, 'datasets', directory);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    const filePath = path.join(dirPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Handle form submission and store data in MongoDB
app.post('/submit', async (req, res) => {
    const { firstName, lastName, age, phone, address, country, email } = req.body;

    let dataset;
    console.log(`Searching for person: ${firstName} ${lastName}`);
    for (let i = 1; i <= 5; i++) {
        const filePath = path.join(__dirname, 'datasets', `person${i}`, 'dataset.json');
        
        try {
            const personData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Checking dataset person${i}:`, personData);
            if (personData.firstName === firstName && personData.lastName === lastName) {
                dataset = personData;
                console.log(`Match found in dataset person${i}`);
                break;
            }
        } catch (err) {
            console.error(`Error reading or parsing file ${filePath}:`, err);
            continue;
        }
    }

    if (!dataset) {
        res.status(400).send('Person not found in the dataset.');
        return;
    }

    try {
        const db = client.db('employee_db');

        // Insert actual data into the employee_details collection
        const employeeDetailsCollection = db.collection('employee_details');
        const employeeDetails = {
            firstName,
            lastName,
            age: parseInt(age),
            phone: parseInt(phone),
            address,
            country,
            email,
            ecg_reading: dataset.ecgReading,
            bpm: dataset.bpm
        };
        await employeeDetailsCollection.insertOne(employeeDetails);
        saveDataLocally(`person${dataset.person}`, 'actual_data.json', employeeDetails);

        // Anonymize data and insert into the employees collection
        const employeesCollection = db.collection('employees');
        const anonymizedData = anonymizeData({ age, ecgReading: dataset.ecgReading, bpm: dataset.bpm });
        await employeesCollection.insertOne(anonymizedData);
        saveDataLocally(`person${dataset.person}`, 'anonymized_data.json', anonymizedData);

        console.log('Data inserted successfully');

        res.send(`Form submitted successfully!<br>First Name: ${firstName}<br>Last Name: ${lastName}<br>Age: ${age}<br>Phone: ${phone}<br>Address: ${address}<br>Country: ${country}<br>Email: ${email}<br>ECG Reading: ${dataset.ecgReading}<br>Bpm: ${dataset.bpm}`);
    } catch (error) {
        console.error('Error inserting data into MongoDB:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Middleware to check if the user is authenticated
function checkAuthentication(req, res, next) {
    if (req.session && req.session.isAuthenticated) {
        next();
    } else {
        res.status(403).send('Forbidden: You are not authenticated');
    }
}

// Route to retrieve anonymized data for data scientist
app.get('/anonymized-data', checkAuthentication, async (req, res) => {
    try {
        const db = client.db('employee_db');
        const collection = db.collection('employees');

        const anonymizedData = await collection.find({}).toArray();

        res.json(anonymizedData);
    } catch (error) {
        console.error('Error retrieving anonymized data from MongoDB:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
