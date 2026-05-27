import axios from 'axios';

const MCP = 'http://fco8og80s4sw4c0wc0ogswws.157.173.111.65.sslip.io/mcp';
const H = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };

await axios.post(MCP, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cli', version: '1.0' } } }, { headers: H });
await axios.post(MCP, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { headers: H });

const update = await axios.post(MCP, {
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: {
    name: 'mongo_update',
    arguments: {
      database: 'vendly',
      collection: 'businesses',
      filter: { name: 'Redatudo' },
      update: { $set: { escalationNotifyList: ['5521969435536'] } },
    },
  },
}, { headers: H });
console.log('UPDATE:', update.data);

const after = await axios.post(MCP, {
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: {
    name: 'mongo_find',
    arguments: { database: 'vendly', collection: 'businesses', filter: { name: 'Redatudo' }, projection: { name: 1, escalationNotifyList: 1 } },
  },
}, { headers: H });
console.log('AFTER:', after.data);
