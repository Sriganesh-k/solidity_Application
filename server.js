const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const session = require('express-session');
const Ajv = require('ajv');
const fs = require('fs');
const csv = require('csv-parser');
const laplaceNoise = require('./laplacenoise'); // Import manual Laplace noise module

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

// Serve static files from the 'views' and root directories
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static(__dirname));

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Serve login.html
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Handle login form submission
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.USERNAME && password === process.env.PASSWORD) {
        req.session.isAuthenticated = true;
        res.redirect('/anonymized-data-graph');
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

        // Process the CSV file first
        const filePath = path.join(path_to_csv_files, `person_${req.body.idCardNumber}.csv`);
        const ecgData = [];
        const bpmData = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                const ecg = parseFloat(row.ecgReading);
                const bpm = parseInt(row.bpm, 10);
                if (!isNaN(ecg)) {
                    ecgData.push(ecg);
                }
                if (!isNaN(bpm)) {
                    bpmData.push(bpm);
                }
            })
            .on('end', async () => {
                if (ecgData.length === 0 || bpmData.length === 0) {
                    return res.status(400).send('CSV file is empty or contains no valid data');
                }

                // Store data in MongoDB
                const employeeDetails = {
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    age: req.body.age,
                    email: req.body.email,
                    idCardNumber: req.body.idCardNumber,
                    ecgReading: ecgData,
                    bpm: bpmData
                };
                const result = await employeeDetailsCollection.insertOne(employeeDetails);

                if (req.body.dataAccessAgreement) {
                    const noiseScale = 1; // Example noise scale; adjust as needed
                    const anonymizedData = {
                        employee_id: result.insertedId,
                        age: employeeDetails.age,
                        ecgReading: ecgData.map(reading => reading + laplaceNoise(noiseScale)),
                        bpm: bpmData.map(reading => reading + laplaceNoise(noiseScale))
                    };
                    await anonymizedDataCollection.insertOne(anonymizedData);
                }

                // Update dataset.json
                const datasetPath = path.join(__dirname, 'dataset.json');
                let dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
                let matchedData = dataset.find(item => item.idCardNumber === req.body.idCardNumber);

                if (!matchedData) {
                    matchedData = {
                        idCardNumber: req.body.idCardNumber,
                        ecgReading: ecgData,
                        bpm: bpmData
                    };
                    dataset.push(matchedData);
                    fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
                }

                console.log('Data inserted and dataset.json updated successfully');

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
            })
            .on('error', (error) => {
                res.status(500).send('Error reading CSV file');
            });
    } catch (error) {
        console.error('Error inserting data:', error);
        res.status(500).send('Error inserting data');
    }
});

app.get('/anonymized-data-graph', async (req, res) => {
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
                <title>Anonymized Data Graph</title>
                <link rel="stylesheet" href="styles.css">
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            </head>
            <body>
                <div class="container">
                    <h1 style="color:black;">Anonymized Data Graph</h1>
                    <div id="charts">
                        ${data.map((row, index) => `
                            <div class="chart-container">
                                <canvas id="chart${index}"></canvas>
                                <script>
                                    const ctx${index} = document.getElementById('chart${index}').getContext('2d');
                                    new Chart(ctx${index}, {
                                        type: 'line',
                                        data: {
                                            labels: Array.from({ length: ${row.ecgReading.length} }, (_, i) => i + 1),
                                            datasets: [
                                                {
                                                    label: 'ECG (mV)',
                                                    data: ${JSON.stringify(row.ecgReading)},
                                                    borderColor: 'blue',
                                                    fill: false,
                                                    yAxisID: 'y',
                                                    tension: 0.1,
                                                    pointRadius: 0
                                                },
                                                {
                                                    label: 'BPM',
                                                    data: ${JSON.stringify(row.bpm)},
                                                    borderColor: 'red',
                                                    fill: false,
                                                    yAxisID: 'y1',
                                                    tension: 0.1,
                                                    pointRadius: 0
                                                }
                                            ]
                                        },
                                        options: {
                                            responsive: true,
                                            scales: {
                                                y: {
                                                    type: 'linear',
                                                    position: 'left',
                                                    title: {
                                                        display: true,
                                                        text: 'ECG (mV)',
                                                        color: 'blue'
                                                    },
                                                    ticks: {
                                                        color: 'blue'
                                                    }
                                                },
                                                y1: {
                                                    type: 'linear',
                                                    position: 'right',
                                                    title: {
                                                        display: true,
                                                        text: 'BPM',
                                                        color: 'red'
                                                    },
                                                    ticks: {
                                                        color: 'red'
                                                    },
                                                    grid: {
                                                        drawOnChartArea: false
                                                    }
                                                }
                                            },
                                            plugins: {
                                                legend: {
                                                    labels: {
                                                        color: '#333'
                                                    }
                                                }
                                            }
                                        }
                                    });
                                </script>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error retrieving anonymized data:', error);
        res.status(500).send('Error retrieving anonymized data');
    }
});



app.get('/anonymized-data-table', async (req, res) => {
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
                                <th>Employee ID</th>
                                <th>Age</th>
                                <th>ECG Reading</th>
                                <th>BPM</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(row => `
                                <tr>
                                    <td>${row.employee_id}</td>
                                    <td>${row.age}</td>
                                    <td>${row.ecgReading.join(', ')}</td>
                                    <td>${row.bpm.join(', ')}</td>
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
    console.log(`Server is running on port ${PORT}`);
});
