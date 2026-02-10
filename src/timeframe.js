const TIMEFRAME_CHOICES = [
  { name: 'Last week', value: '1w' },
  { name: 'Last 2 weeks', value: '2w' },
  { name: 'Last month', value: '1m' },
  { name: 'Last 3 months', value: '3m' },
  { name: 'Last 6 months', value: '6m' },
  { name: 'Last year', value: '1y' },
  { name: 'All time', value: 'all' },
];

const DURATIONS = {
  '1w': 7,
  '2w': 14,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
};

function filterByTimeframe(entries, timeframe) {
  if (!timeframe || timeframe === 'all') return entries;

  const days = DURATIONS[timeframe];
  if (!days) return entries;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  return entries.filter(e => e.timestamp >= cutoff);
}

function timeframeLabel(timeframe) {
  if (!timeframe || timeframe === 'all') return 'all time';
  const match = TIMEFRAME_CHOICES.find(c => c.value === timeframe);
  return match ? match.name.toLowerCase() : timeframe;
}

module.exports = { TIMEFRAME_CHOICES, filterByTimeframe, timeframeLabel };
