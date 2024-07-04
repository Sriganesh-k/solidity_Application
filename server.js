const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const session = require('express-session');
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
        "email": { "type": "string", "format": "email" },
        "idCardNumber": { "type": "string" }
    },
    "required": ["firstName", "lastName", "age", "email", "idCardNumber"]
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

// Handle form submission and store data in MongoDB
app.post('/submit', async (req, res) => {
    const { firstName, lastName, age, email, idCardNumber } = req.body;

    // Validate the incoming data
    const valid = validate(req.body);
    if (!valid) {
        res.status(400).send('Invalid form data');
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
            email,
            idCardNumber
        };
        await employeeDetailsCollection.insertOne(employeeDetails);

        console.log('Data inserted successfully');

        res.send(`Form submitted successfully!<br>First Name: ${firstName}<br>Last Name: ${lastName}<br>Age: ${age}<br>Email: ${email}<br>ID Card Number: ${idCardNumber}`);
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

        let tableRows = '';
        anonymizedData.forEach(item => {
            tableRows += `
                <tr>
                    <td>${item.employee_id}</td>
                    <td>${item.age}</td>
                    <td>${item.ecg_reading}</td>
                    <td>${item.bpm}</td>
                </tr>
            `;
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Data Scientist Information</title>
                <link rel="stylesheet" href="styles.css">
                <style>
                    body {
                        font-family: 'Roboto', sans-serif;
                        background-color: #f4f7f6;
                        margin: 0;
                        padding: 20px;
                    }

                    .table-container {
                        background-color: rgba(0, 0, 0, 0.8); /* Darker transparent background */
                        padding: 20px;
                        border-radius: 10px;
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                        max-width: 1000px;
                        margin: auto;
                        color: #fff;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }

                    th, td {
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }

                    th {
                        background-color: #ffd700; /* Gold color */
                        color: black;
                    }

                    tr:nth-child(even) {
                        background-color: #333;
                    }

                    tr:hover {
                        background-color: #444;
                    }
                </style>
            </head>
            <body>
                <div class="table-container">
                    <h1>Data Scientist Information</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>Employee ID</th>
                                <th>Age</th>
                                <th>ECG Reading</th>
                                <th>BPM</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error retrieving anonymized data from MongoDB:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
