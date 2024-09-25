const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const session = require('express-session');
const Ajv = require('ajv');
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
// Save login activity to MongoDB
app.post('/save-login', async (req, res) => {
    const { account, txHash, timestamp } = req.body;

    // Log incoming request data to verify it's correct
    console.log("Received data from frontend:", req.body);

    try {
        const db = client.db('blockchain_db');
        const loginCollection = db.collection('datascientist_details');

        const loginRecord = {
            account,
            txHash,
            timestamp: new Date(timestamp),
        };

        console.log("Saving the following login record to MongoDB:", loginRecord);

        const result = await loginCollection.insertOne(loginRecord);

        console.log("MongoDB Insert Result:", result);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving login to MongoDB:', error);
        res.json({ success: false });
    }
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static(__dirname));

app.post('/save-login', async (req, res) => {
    const { account, txHash, timestamp } = req.body;
    try {
        const db = client.db('blockchain_db');
        const loginCollection = db.collection('datascientist_details');
        const loginRecord = {
            account,
            txHash,
            timestamp: new Date(timestamp),
        };
        const result = await loginCollection.insertOne(loginRecord);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving login to MongoDB:', error);
        res.json({ success: false });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/datascientist-login-page', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        req.session.isAuthenticated = true;
        res.json({ success: true, redirectUrl: '/anonymized-data' });
    } else {
        res.json({ success: false });
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
                <link rel="stylesheet" href="styles.css"> <!-- Linking styles.css for consistent styling -->
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
                                    <td>${row.age || 'N/A'}</td>
                                    <td><a href="/downloads/${row.employee_id}_anonymized.csv" download>Download Dataset</a></td>
                                </tr>`).join('')}
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

                res.send(
                    `<!DOCTYPE html>
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
                    </html>`
                );
            } else {
                res.status(500).send('Error processing data');
            }
        });
    } catch (error) {
        console.error('Error inserting data:', error);
        res.status(500).send('Error inserting data');
    }
});

/*app.get('/anonymized-data', async (req, res) => {
    if (!req.session.isAuthenticated) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const db = client.db('employee_db');
        const anonymizedDataCollection = db.collection('anonymized_data');
        const data = await anonymizedDataCollection.find().toArray();

        res.send(
            `<!DOCTYPE html>
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
                            ${data.map(row => 
                                `<tr>
                                    <td>${row._id}</td>
                                    <td>${row.age !== undefined ? row.age : 'undefined'}</td>
                                    <td><a href="/downloads/${row.employee_id}_anonymized.csv" download>Download Dataset</a></td>
                                </tr>`
                            ).join('')}
                        </tbody>
                    </table>
                </div>
            </body>
            </html>`
        );
    } catch (error) {
        console.error('Error retrieving anonymized data:', error);
        res.status(500).send('Error retrieving anonymized data');
    }
});*/

app.get('/employee-admin-page', (req, res) => {
    res.send(
        `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Employee Admin Page</title>
            <link rel="stylesheet" href="styles.css">
        </head>
        <body>
            <div class="container">
                <h1>Employee Admin Page</h1>
                <form id="searchForm">
                    <label for="companyId">Enter Company ID:</label>
                    <input type="text" id="companyId" name="companyId" required>
                    <button type="submit">Search</button>
                </form>
                <div id="result"></div>
            </div>
            <script>
                document.getElementById('searchForm').addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const companyId = document.getElementById('companyId').value;
                    const response = await fetch('/searchEmployee', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ companyId })
                    });
                    const result = await response.json();
                    document.getElementById('result').innerHTML = result.html;
                });
            </script>
        </body>
        </html>`
    );
});

app.post('/searchEmployee', async (req, res) => {
    const { companyId } = req.body;
    try {
        const db = client.db('employee_db');
        const employeeDetailsCollection = db.collection('employee_details');
        const employee = await employeeDetailsCollection.findOne({ idCardNumber: companyId });

        if (employee) {
            res.json({
                html: `
                <form action="/updateEmployee" method="POST">
                    <input type="hidden" name="employeeId" value="${employee._id}">
                    <label for="firstName">First Name:</label>
                    <input type="text" id="firstName" name="firstName" value="${employee.firstName}" required>
                    <label for="lastName">Last Name:</label>
                    <input type="text" id="lastName" name="lastName" value="${employee.lastName}" required>
                    <label for="age">Age:</label>
                    <input type="number" id="age" name="age" value="${employee.age}" required>
                    <label for="email">Email:</label>
                    <input type="email" id="email" name="email" value="${employee.email}" required>
                    <label for="idCardNumber">ID Card Number:</label>
                    <input type="text" id="idCardNumber" name="idCardNumber" value="${employee.idCardNumber}" required>
                    <label for="privacyAgreement">Privacy Agreement:</label>
                    <input type="checkbox" id="privacyAgreement" name="privacyAgreement" ${employee.privacyAgreement ? 'checked' : ''}>
                    <label for="dataAccessAgreement">Data Access Agreement:</label>
                    <input type="checkbox" id="dataAccessAgreement" name="dataAccessAgreement" ${employee.dataAccessAgreement ? 'checked' : ''}>
                    <button type="submit">Update</button>
                </form>`
            });
        } else {
            res.json({ html: 'No employee found with the given ID' });
        }
    } catch (error) {
        console.error('Error searching employee:', error);
        res.status(500).send('Error searching employee');
    }
});

app.post('/updateEmployee', async (req, res) => {
    const employeeId = req.body.employeeId;
    const updatedEmployee = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        age: parseInt(req.body.age, 10),
        email: req.body.email,
        idCardNumber: req.body.idCardNumber,
        privacyAgreement: req.body.privacyAgreement === 'on',
        dataAccessAgreement: req.body.dataAccessAgreement === 'on'
    };

    try {
        const db = client.db('employee_db');
        const employeeDetailsCollection = db.collection('employee_details');
        const anonymizedDataCollection = db.collection('anonymized_data');

        // Update employee details
        await employeeDetailsCollection.updateOne(
            { _id: new ObjectId(employeeId) },
            { $set: updatedEmployee }
        );

        // Check if data access agreement is revoked
        if (!updatedEmployee.dataAccessAgreement) {
            // Find and delete anonymized data for the employee
            await anonymizedDataCollection.deleteOne({ employee_id: employeeId });
        }

        res.send(
            `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Update Successful</title>
                <link rel="stylesheet" href="styles.css">
            </head>
            <body>
                <div class="container">
                    <h1>Update Successful</h1>
                    <p>The employee details have been updated successfully.</p>
                </div>
            </body>
            </html>`
        );
    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).send('Error updating employee');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
