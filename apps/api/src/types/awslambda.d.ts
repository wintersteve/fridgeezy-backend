import type { Writable } from "node:stream";

/**
 * Ambient declarations for the response-streaming API that the Node.js managed
 * Lambda runtime injects as a global. AWS publishes no types package for it, so
 * these mirror the documented surface — only the parts `lambda.ts` uses.
 */
declare global {
    interface LambdaResponseStream extends Writable {
        setContentType(contentType: string): void;
    }

    interface LambdaHttpResponseMetadata {
        statusCode?: number;
        headers?: Record<string, string>;
        cookies?: string[];
    }

    interface LambdaContext {
        awsRequestId: string;
        functionName: string;
        /**
         * Set to false when the execution environment keeps long-lived handles
         * open, otherwise Lambda waits for the event loop to empty.
         */
        callbackWaitsForEmptyEventLoop: boolean;
        getRemainingTimeInMillis(): number;
    }

    /** Function URL request, payload format version 2.0. */
    interface LambdaFunctionUrlEvent {
        version: string;
        rawPath: string;
        rawQueryString: string;
        headers: Record<string, string | undefined>;
        cookies?: string[];
        body?: string | null;
        isBase64Encoded: boolean;
        requestContext: {
            http: {
                method: string;
                path: string;
                sourceIp: string;
            };
        };
    }

    const awslambda: {
        streamifyResponse(
            handler: (
                event: LambdaFunctionUrlEvent,
                responseStream: LambdaResponseStream,
                context: LambdaContext
            ) => Promise<void>
        ): (event: LambdaFunctionUrlEvent, context: LambdaContext) => Promise<void>;

        HttpResponseStream: {
            from(
                responseStream: LambdaResponseStream,
                metadata: LambdaHttpResponseMetadata
            ): LambdaResponseStream;
        };
    };
}

export {};
