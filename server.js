const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const session = require('express-session');
const Ajv = require('ajv');
const fs = require('fs');
const { spawn } = require('child_process');

dotenv.config();

const ajv = new Ajv();
ajv.addFormat('email', (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
});

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

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

async function connectToDB() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
    }
}

connectToDB().catch(console.error);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        req.session.isAuthenticated = true;
        res.redirect('/anonymized-data');
    } else {
        res.status(401).send('Invalid username or password');
    }
});

const path_to_csv_files = path.join(__dirname, 'path_to_csv_files');

app.post('/submit', async (req, res) => {
    req.body.age = parseInt(req.body.age, 10);
    req.body.privacyAgreement = req.body.privacyAgreement === 'on';
    req.body.dataAccessAgreement = req.body.dataAccessAgreement === 'on';

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

        const filePath = path.join(path_to_csv_files, `person_${req.body.idCardNumber}.csv`);

        // Insert employee details into employee_details collection
        const employeeDetails = {
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            age: req.body.age,
            email: req.body.email,
            idCardNumber: req.body.idCardNumber,
            privacyAgreement: req.body.privacyAgreement,
            dataAccessAgreement: req.body.dataAccessAgreement
        };

        const employeeDetailsResult = await employeeDetailsCollection.insertOne(employeeDetails);

        // Call Python script to process and anonymize data
        const pythonProcess = spawn('python3', ['process_data.py', filePath, employeeDetailsResult.insertedId.toString()]);

        pythonProcess.stdout.on('data', (data) => {
            console.log(`Python stdout: ${data}`);
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`Python stderr: ${data}`);
        });

        pythonProcess.on('close', async (code) => {
            if (code === 0) {
                console.log('Data processed and anonymized successfully');

                res.send(`
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Form Submission Successful</title>
                        <link rel="stylesheet" href="styles.css">
                    </head>
                    <body>
                        <div class="container">
                            <h1>Form Submission Successful</h1>
                            <p>Thank you for submitting your information. Your data has been processed and stored successfully.</p>
                        </div>
                    </body>
                    </html>
                `);
            } else {
                res.status(500).send('Error processing data');
            }
        });
    } catch (error) {
        console.error('Error inserting data:', error);
        res.status(500).send('Error inserting data');
    }
});

app.get('/anonymized-data', async (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const db = client.db('employee_db');
        const anonymizedDataCollection = db.collection('anonymized_data');
        const data = await anonymizedDataCollection.find().toArray();

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Anonymized Data Table</title>
                <link rel="stylesheet" href="styles.css">
            </head>
            <body>
                <div class="container">
                    <h1>Anonymized Data Table</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>Anonymized Employee ID</th>
                                <th>Age</th>
                                <th>Download CSV</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(row => `
                                <tr>
                                    <td>${row._id}</td>
                                    <td>${row.age !== undefined ? row.age : 'undefined'}</td>
                                    <td><a href="/downloads/${row.employee_id}_anonymized.csv" download>Download Dataset </a></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error retrieving anonymized data:', error);
        res.status(500).send('Error retrieving anonymized data');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
