require('dotenv').config();
const axios = require('axios');

(async () => {
  const { data } = await axios.get('https://workflows.vendly.chat/api/v1/executions', {
    headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' },
    params: { workflowId: 'jleu4RPvSnYDL8Gd', limit: 15 }
  });
  
  console.log('Last 15 executions:\n');
  data.data.forEach(e => {
    const ts = e.startedAt ? new Date(e.startedAt).toISOString().slice(0, 19) : 'N/A';
    const status = e.status === 'success' ? 'OK' : 'ERR';
    console.log('  [' + status + '] exec ' + e.id + '  ' + ts);
  });
})().catch(e => console.error(e.message));
