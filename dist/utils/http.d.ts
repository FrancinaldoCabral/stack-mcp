import { type AxiosInstance } from 'axios';
export declare function createClient(baseURL: string, headers?: Record<string, string>): AxiosInstance;
export declare function safeRequest<T>(fn: () => Promise<T>): Promise<{
    data: T;
} | {
    error: string;
}>;
export declare function toText(result: {
    data: unknown;
} | {
    error: string;
}): string;
