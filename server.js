const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const session = require('express-session');
const Ajv = require('ajv');
const fs = require('fs');
const csv = require('csv-parser');

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
        "idCardNumber": { "type": "string" },
        "privacyAgreement": { "type": "boolean" },
        "dataAccessAgreement": { "type": "boolean" }
    },
    "required": ["firstName", "lastName", "age", "email", "idCardNumber", "privacyAgreement"]
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

// Function to read CSV and calculate average ECG and BPM
const path_to_csv_files = path.join(__dirname, 'path_to_csv_files');

function calculateAveragesFromCSV(id) {
    return new Promise((resolve, reject) => {
        const filePath = path.join(path_to_csv_files, `person_${id}.csv`);
        const data = [];
        fs.createReadStream(filePath)
            .pipe(csv({
                headers: false
            }))
            .on('data', (row) => {
                const value = parseFloat(row[0]);
                if (!isNaN(value)) {
                    data.push(value);
                }
            })
            .on('end', () => {
                if (data.length === 0) {
                    return reject(new Error('CSV file is empty or contains no valid data'));
                }
                const total = data.reduce((sum, value) => sum + value, 0);
                const avg = total / data.length;
                resolve({ avgECG: avg, avgBPM: avg }); // Assuming both ECG and BPM are the same for simplicity
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// Handle form submission and store data in MongoDB
app.post('/submit', async (req, res) => {
    // Convert age to an integer and privacyAgreement and dataAccessAgreement to boolean
    req.body.age = parseInt(req.body.age, 10);
    req.body.privacyAgreement = req.body.privacyAgreement === 'on';
    req.body.dataAccessAgreement = req.body.dataAccessAgreement === 'on';

    // Validate the incoming data
    const valid = validate(req.body);
    if (!valid) {
        console.log(validate.errors);
        res.status(400).send('Invalid form data');
        return;
    }

    try {
        const db = client.db('employee_db');
        const employeeDetailsCollection = db.collection('employee_details');
        const anonymizedDataCollection = db.collection('anonymized_data');

        // Read dataset.json file
        const datasetPath = path.join(__dirname, 'dataset.json');
        const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
        let matchedData = dataset.find(item => item.idCardNumber === req.body.idCardNumber);

        if (!matchedData) {
            const { avgECG, avgBPM } = await calculateAveragesFromCSV(req.body.idCardNumber);
            matchedData = {
                idCardNumber: req.body.idCardNumber,
                ecgReading: avgECG,
                bpm: avgBPM
            };
            dataset.push(matchedData);
            fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
        } else {
            const { avgECG, avgBPM } = await calculateAveragesFromCSV(req.body.idCardNumber);
            matchedData.ecgReading = avgECG;
            matchedData.bpm = avgBPM;
            fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
        }

        const employeeDetails = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            age: req.body.age,
            email: req.body.email,
            idCardNumber: req.body.idCardNumber,
            ecgReading: matchedData.ecgReading,
            bpm: matchedData.bpm
        };
        const result = await employeeDetailsCollection.insertOne(employeeDetails);

        if (req.body.dataAccessAgreement) {
            const anonymizedData = {
                employee_id: result.insertedId,
                age: employeeDetails.age,
                ecgReading: employeeDetails.ecgReading,
                bpm: employeeDetails.bpm
            };
            await anonymizedDataCollection.insertOne(anonymizedData);
        }

        console.log('Data inserted successfully');

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Form Submission Successful</title>
                <style>
                    body {
                        font-family: 'Roboto', sans-serif;
                        background-image: url('backgroundgold.jpg');
                        background-size: cover;
                        background-repeat: no-repeat;
                        background-attachment: fixed;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        padding: 0;
                    }
                    .submission-container {
                        background-color: rgba(255, 255, 255, 0.8); /* Lightly transparent background */
                        padding: 30px;
                        border-radius: 10px;
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                        width: 400px;
                        text-align: center;
                    }
                    .submission-container h2 {
                        font-weight: 500;
                        margin-bottom: 20px;
                        color: #333;
                    }
                    .submitted-data {
                        text-align: left;
                        margin-bottom: 20px;
                    }
                    .submitted-data p {
                        margin: 10px 0;
                        color: #555;
                    }
                </style>
            </head>
            <body>
                <div class="submission-container">
                    <h2>Form Submission Successful</h2>
                    <div class="submitted-data">
                        <p><strong>Name:</strong> ${req.body.firstName} ${req.body.lastName}</p>
                        <p><strong>Age:</strong> ${req.body.age}</p>
                        <p><strong>Email:</strong> ${req.body.email}</p>
                        <p><strong>ID Card Number:</strong> ${req.body.idCardNumber}</p>
                        <p><strong>Average ECG Reading:</strong> ${matchedData.ecgReading}</p>
                        <p><strong>Average BPM:</strong> ${matchedData.bpm}</p>
                    </div>
                </div>
            </body>
            </html>
        `);
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
        const anonymizedDataCollection = db.collection('anonymized_data');

        const anonymizedData = await anonymizedDataCollection.find({}).toArray();
        res.json(anonymizedData);
    } catch (error) {
        console.error('Error retrieving anonymized data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
