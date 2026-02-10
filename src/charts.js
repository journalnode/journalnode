const BLUE = 'rgba(54, 133, 235, 0.8)';
const BLUE_LIGHT = 'rgba(54, 133, 235, 0.2)';
const ORANGE = 'rgba(255, 159, 64, 0.8)';
const TEAL = 'rgba(75, 192, 192, 0.8)';

async function renderChart(config, width = 800, height = 400) {
  const res = await fetch('https://quickchart.io/chart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: config,
      width,
      height,
      format: 'png',
      backgroundColor: 'white',
    }),
  });
  if (!res.ok) throw new Error(`QuickChart error: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function barChart(title, labels, data, color = BLUE) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: title,
        data,
        backgroundColor: color,
      }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { display: false },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: {
        datalabels: { anchor: 'end', align: 'top', font: { weight: 'bold' } },
      },
    },
  };
}

function scatterWithLine(title, scatterData, lineData, lineLabel) {
  return {
    type: 'bar',
    data: {
      labels: scatterData.map(p => p.x),
      datasets: [
        {
          type: 'scatter',
          label: 'Word Count',
          data: scatterData,
          backgroundColor: BLUE,
          pointRadius: 4,
        },
        {
          type: 'line',
          label: lineLabel || 'Rolling Avg',
          data: lineData,
          borderColor: ORANGE,
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
}

function histogram(title, bins, frequencies, meanLine, binSize) {
  const labels = bins.map(b => `${b}`);
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Frequency',
        data: frequencies,
        backgroundColor: BLUE,
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { display: false },
      scales: {
        xAxes: [{ scaleLabel: { display: true, labelString: 'Word Count' } }],
        yAxes: [{ ticks: { beginAtZero: true }, scaleLabel: { display: true, labelString: 'Frequency' } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
  if (meanLine !== undefined) {
    const meanIdx = Math.floor(meanLine / binSize);
    config.options.annotation = {
      annotations: [{
        type: 'line',
        mode: 'vertical',
        scaleID: 'x-axis-0',
        value: meanIdx,
        borderColor: ORANGE,
        borderWidth: 2,
        borderDash: [6, 4],
        label: { enabled: true, content: `Mean: ${meanLine} words`, position: 'top' },
      }],
    };
  }
  return config;
}

function areaChart(title, labels, data, color = TEAL) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: title,
        data,
        backgroundColor: color.replace('0.8', '0.3'),
        borderColor: color,
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
      }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { display: false },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
}

function lineChart(title, labels, data, color = BLUE) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: title,
        data,
        borderColor: color,
        backgroundColor: color.replace('0.8', '0.1'),
        borderWidth: 2,
        fill: true,
        pointRadius: 3,
      }],
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      legend: { display: false },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
}

function multiLineChart(title, labels, datasets) {
  const COLORS = [BLUE, ORANGE, TEAL, 'rgba(153, 102, 255, 0.8)', 'rgba(255, 99, 132, 0.8)'];
  return {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.data,
        borderColor: COLORS[i % COLORS.length],
        borderWidth: 2,
        fill: false,
        pointRadius: 3,
      })),
    },
    options: {
      title: { display: true, text: title, fontSize: 16 },
      scales: {
        yAxes: [{ ticks: { beginAtZero: true } }],
      },
      plugins: { datalabels: { display: false } },
    },
  };
}

module.exports = {
  renderChart,
  barChart,
  scatterWithLine,
  histogram,
  areaChart,
  lineChart,
  multiLineChart,
  BLUE,
  ORANGE,
  TEAL,
};
