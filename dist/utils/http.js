import axios from 'axios';
export function createClient(baseURL, headers = {}) {
    return axios.create({ baseURL, headers, timeout: 30_000 });
}
export async function safeRequest(fn) {
    try {
        const data = await fn();
        return { data };
    }
    catch (err) {
        if (axios.isAxiosError(err)) {
            const msg = err.response?.data
                ? JSON.stringify(err.response.data)
                : err.message;
            return { error: `HTTP ${err.response?.status ?? 'ERR'}: ${msg}` };
        }
        return { error: String(err) };
    }
}
export function toText(result) {
    if ('error' in result)
        return `❌ Erro: ${result.error}`;
    return JSON.stringify(result.data, null, 2);
}
