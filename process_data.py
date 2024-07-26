import os
import pymongo
import random
import math
import json
import csv
from pymongo import MongoClient

# MongoDB connection
client = MongoClient('mongodb://localhost:27017')
db = client['employee_db']
anonymized_data_collection = db['anonymized_data']

def laplace_noise(scale):
    u = random.random() - 0.5
    return scale * math.copysign(1.0, u) * math.log(1 - 2 * abs(u))

def process_and_anonymize(file_path, employee_id, scale=1.0):
    ecg_data = []
    bpm_data = []

    with open(file_path, 'r') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            ecg = float(row['ecgReading'])
            bpm = int(row['bpm'])
            ecg_data.append(ecg + laplace_noise(scale))
            bpm_data.append(bpm + laplace_noise(scale))

    # Create HL7 FHIR resources manually
    patient = {
        "resourceType": "Patient",
        "id": employee_id,
        "name": [{"family": "Doe", "given": ["John"]}],
        "gender": "male",
        "birthDate": "1980-01-01"
    }

    observation = {
        "resourceType": "Observation",
        "id": "example",
        "status": "final",
        "code": {
            "coding": [{
                "system": "http://loinc.org",
                "code": "85354-9",
                "display": "Blood pressure panel with all children optional"
            }]
        },
        "subject": {"reference": f"Patient/{employee_id}"},
        "effectiveDateTime": "2020-07-21T13:27:00Z",
        "valueQuantity": {
            "value": 120,
            "unit": "mmHg",
            "system": "http://unitsofmeasure.org",
            "code": "mm[Hg]"
        }
    }

    anonymized_data = {
        'employee_id': employee_id,
        'ecgReading': ecg_data,
        'bpm': bpm_data,
        'age': int(40 + laplace_noise(scale)),  # Anonymize age
        'patient': patient,
        'observation': observation
    }

    anonymized_data_collection.insert_one(anonymized_data)

    # Create CSV file in HL7 FHIR format
    output_file_path = os.path.join('downloads', f'{employee_id}_anonymized.csv')
    with open(output_file_path, 'w', newline='') as csvfile:
        fieldnames = ['ecgReading', 'bpm', 'FHIR_Patient', 'FHIR_Observation']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for ecg, bpm in zip(ecg_data, bpm_data):
            writer.writerow({
                'ecgReading': ecg,
                'bpm': bpm,
                'FHIR_Patient': json.dumps(patient),
                'FHIR_Observation': json.dumps(observation)
            })

def main(file_path, employee_id):
    process_and_anonymize(file_path, employee_id)

if __name__ == '__main__':
    import sys
    main(sys.argv[1], sys.argv[2])
