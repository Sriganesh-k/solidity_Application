document.addEventListener('DOMContentLoaded', function() {
    fetch('/anonymized-data-graph/data')
        .then(response => response.json())
        .then(data => {
            const ctx = document.getElementById('myChart').getContext('2d');

            const datasets = [];
            const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];

            data.forEach((personData, index) => {
                datasets.push({
                    label: `Person ${index + 1} - ECG`,
                    data: personData.ecg,
                    borderColor: colors[index],
                    fill: false,
                    yAxisID: 'y-axis-ecg'
                });
                datasets.push({
                    label: `Person ${index + 1} - BPM`,
                    data: personData.bpm,
                    borderColor: colors[index],
                    borderDash: [5, 5],
                    fill: false,
                    yAxisID: 'y-axis-bpm'
                });
            });

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: Array.from({length: 48}, (_, i) => `${i}h`),
                    datasets: datasets
                },
                options: {
                    scales: {
                        yAxes: [{
                            id: 'y-axis-ecg',
                            type: 'linear',
                            position: 'left',
                            scaleLabel: {
                                display: true,
                                labelString: 'ECG'
                            }
                        }, {
                            id: 'y-axis-bpm',
                            type: 'linear',
                            position: 'right',
                            scaleLabel: {
                                display: true,
                                labelString: 'BPM'
                            },
                            gridLines: {
                                drawOnChartArea: false
                            }
                        }],
                        xAxes: [{
                            scaleLabel: {
                                display: true,
                                labelString: 'Hours'
                            }
                        }]
                    },
                    title: {
                        display: true,
                        text: 'ECG and BPM Readings for 5 Persons Over 48 Hours'
                    }
                }
            });
        });
});
