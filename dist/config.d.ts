import 'dotenv/config';
export declare const config: {
    n8n: {
        url: string;
        apiKey: string;
    };
    evolution: {
        url: string;
        apiKey: string;
    };
    chatwoot: {
        url: string;
        apiKey: string;
        accountId: string;
    };
    mongodb: {
        uri: string;
    };
    redis: {
        url: string;
    };
    qdrant: {
        url: string;
        apiKey: string;
    };
    coolify: {
        url: string;
        token: string;
    };
    openrouter: {
        apiKey: string;
        embeddingModel: string;
    };
    admin: {
        apiKey: string;
    };
    smtp: {
        host: string;
        port: number;
        user: string;
        password: string;
        from: string;
    };
};
