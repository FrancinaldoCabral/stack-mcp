import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export declare const deliveryTools: Tool[];
export declare function handleDeliveryTool(name: string, args: Record<string, unknown>): Promise<string>;
